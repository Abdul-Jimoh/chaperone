import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PaymentDeps } from "@/lib/payments/service";
import { cartInput, checkMandate, listSpend, requestPaymentTool, revokeMandateTool } from "./tools";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** One server per mandate: the agent key chose the mandate before this was built, and no tool takes a mandate id. */
export function createMcpServer(deps: PaymentDeps, mandateId: string): McpServer {
  const server = new McpServer(
    { name: "chaperone", version: "0.1.0" },
    {
      instructions:
        "Pay through PayPal under the user's spending mandate. Call check_mandate first to see the allowed shops, " +
        "categories and remaining budget. request_payment returns allow, needs_approval or deny; the mandate decides, " +
        "and a denied request will not succeed by rewording it.",
    },
  );

  server.registerTool(
    "check_mandate",
    {
      title: "Check the mandate",
      description:
        "The user's rules for this agent: allowed shops (with the merchant IDs to pay), categories, per-purchase cap, " +
        "approval threshold and remaining budget. Pass a cart to preview the decision without reserving anything.",
      inputSchema: { cart: z.object(cartInput).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cart }) => json(await checkMandate(deps, mandateId, cart)),
  );

  server.registerTool(
    "request_payment",
    {
      title: "Request a payment",
      description:
        "Pay one shop for a cart. Places a PayPal hold and captures it if the mandate allows, waits for the user if it " +
        "needs approval, and charges nothing if denied. Sending the same cart again the same day returns the first result instead of paying twice.",
      inputSchema: cartInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => json(await requestPaymentTool(deps, mandateId, input)),
  );

  server.registerTool(
    "list_spend",
    {
      title: "List spending",
      description: "Budget used and remaining per window, and recent payments under this mandate with their decision, rule and status.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => json(await listSpend(deps, mandateId, limit)),
  );

  server.registerTool(
    "revoke_mandate",
    {
      title: "Revoke the mandate",
      description: "Stops all spending under this mandate: open holds are released and every later request is denied. Cannot be undone by the agent.",
      inputSchema: {},
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => json(await revokeMandateTool(deps, mandateId)),
  );

  return server;
}
