import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PaymentDeps } from "@/lib/payments/service";
import { eq } from "drizzle-orm";
import { mandates } from "@/db/schema";
import { cartInput, checkMandate, listSpend, requestPaymentTool, revokeMandateTool, searchProducts, type Shopping } from "./tools";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** One server per mandate: the agent key chose the mandate before this was built, and no tool takes a mandate id. */
export function createMcpServer(deps: PaymentDeps, mandateId: string, shopping?: Shopping): McpServer {
  const server = new McpServer(
    { name: "chaperone", version: "0.1.0" },
    {
      instructions:
        "Shop and pay through PayPal under the user's spending mandate. Call check_mandate first to see the allowed shops, " +
        "categories and remaining budget, search_products to find items with real prices, then request_payment with listing ids. " +
        "request_payment returns allow, needs_approval or deny; the mandate decides, and a denied request will not succeed by rewording it.",
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
    async ({ cart }) => json(await checkMandate(deps, mandateId, cart, shopping)),
  );

  server.registerTool(
    "request_payment",
    {
      title: "Request a payment",
      description:
        "Pay one shop for a cart: listing ids from search_products, or titled, priced items for shops outside the catalog. Places a PayPal hold and captures it if the mandate allows, waits for the user if it " +
        "needs approval, and charges nothing if denied. Sending the same cart again the same day returns the first result instead of paying twice, unless its hold was released (rejected or expired). A per-run budget covers everything MCP agents spend under this mandate in one day.",
      inputSchema: cartInput,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => json(await requestPaymentTool(deps, mandateId, input, shopping)),
  );

  if (shopping) {
    server.registerTool(
      "search_products",
      {
        title: "Search products",
        description:
          "Search the shops' catalog. Returns listings with a listing_id, title, price in cents, the shop selling it and whether that shop is on " +
          "the user's list. Pay for listings with request_payment using listing_id and quantity; Chaperone fills in the price and seller.",
        inputSchema: { query: z.string().min(1).max(200).describe("What to look for, e.g. 'dry dog food 5 kg'.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ query }) => {
        const [mandate] = await deps.db.select({ policy: mandates.policy }).from(mandates).where(eq(mandates.id, mandateId));
        return json(await searchProducts(shopping, mandate!.policy, query));
      },
    );
  }

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
