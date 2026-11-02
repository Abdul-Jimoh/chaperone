import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agentKeys, payments } from "@/db/schema";
import type { PaymentDeps } from "@/lib/payments/service";
import { handleMcpRequest } from "@/mcp/http";
import { issueAgentKey } from "@/mcp/keys";
import { requestPaymentTool } from "@/mcp/tools";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(10);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const now = new Date("2026-11-03T15:00:00Z");

async function setup() {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
  const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees, clock: () => now };
  const mandate = await seedLinkedMandate(db, samplePolicy());
  const key = await issueAgentKey(db, mandate.id, "test agent");
  const handler: typeof fetch = async (input, init) => handleMcpRequest(new Request(input, init), deps);
  return { paypal, deps, mandate, key, handler };
}

async function connect(handler: typeof fetch, key: string) {
  const client = new Client({ name: "second-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://chaperone.test/api/mcp"), {
    fetch: handler,
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: result.isError, data: JSON.parse(first!.text) };
}

const coffee = { title: "Whole bean coffee, 1 kg", unit_price_cents: 1_800, quantity: 1, category: "coffee" };

describe("MCP server", () => {
  it("exposes exactly the four mandate tools", async () => {
    const { handler, key } = await setup();
    const client = await connect(handler, key);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_mandate", "list_spend", "request_payment", "revoke_mandate"]);
    expect(JSON.stringify(tools)).not.toContain("mandate_id");
  });

  it("refuses requests without a valid agent key", async () => {
    const { handler, key } = await setup();
    await expect(connect(handler, "chp_ak_not-a-real-key")).rejects.toThrow();
    const res = await handler("https://chaperone.test/api/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    await (await connect(handler, key)).close();
    await db.update(agentKeys).set({ revokedAt: now });
    await expect(connect(handler, key)).rejects.toThrow();
  });

  it("check_mandate lists the shops to pay and the budget left", async () => {
    const { handler, key } = await setup();
    const client = await connect(handler, key);
    const { data } = await call(client, "check_mandate");
    expect(data.shops).toEqual([
      { name: "Bean Supply Co", merchant_id: SHOP_A },
      { name: "Pet Pantry", merchant_id: SHOP_B },
    ]);
    expect(data.budgets).toContainEqual({ period: "month", limit_cents: 15_000, used_cents: 0, remaining_cents: 15_000 });
    expect(data.mandate.rules).toContain("Ask me before anything over $40.00");
  });

  it("previews a decision without reserving anything", async () => {
    const { handler, key } = await setup();
    const client = await connect(handler, key);
    const { data } = await call(client, "check_mandate", { cart: { payee_merchant_id: ROGUE, items: [coffee] } });
    expect(data.preview).toMatchObject({ decision: "deny", clause: { id: "payee.allowlist" } });
    expect(await db.select().from(payments)).toEqual([]);
  });

  it("a second agent pays under the mandate, and a retry doesn't pay twice", async () => {
    const { handler, key, paypal } = await setup();
    const client = await connect(handler, key);
    const cart = { payee_merchant_id: SHOP_A, items: [coffee] };
    const first = await call(client, "request_payment", cart);
    expect(first.data).toMatchObject({ decision: "allow", status: "captured", shop: "Bean Supply Co", message: "Paid $18.00 to Bean Supply Co." });
    const again = await call(client, "request_payment", cart);
    expect(again.data).toMatchObject({ payment_id: first.data.payment_id, already_requested: true });
    expect(paypal.ops()).toEqual(["order:platform-app", "capture:platform-app"]);

    const spend = await call(client, "list_spend");
    expect(spend.data.payments).toHaveLength(1);
    expect(spend.data.budgets).toContainEqual({ period: "month", limit_cents: 15_000, used_cents: 1_800, remaining_cents: 13_200 });
  });

  it("an injected cart is denied on the payee and the cap, and says why", async () => {
    const { handler, key, paypal } = await setup();
    const client = await connect(handler, key);
    const { data } = await call(client, "request_payment", { payee_merchant_id: ROGUE, items: [{ ...coffee, quantity: 10 }] });
    expect(data).toMatchObject({ decision: "deny", status: "denied", clause_id: "payee.allowlist" });
    expect(data.message).toMatch(/^Denied by the mandate: Only pay these shops/);
    expect(paypal.calls).toEqual([]);
  });

  it("over the threshold it waits for the user and gives the agent no link", async () => {
    const { handler, key } = await setup();
    const client = await connect(handler, key);
    const { data } = await call(client, "request_payment", {
      payee_merchant_id: SHOP_B,
      items: [{ title: "Dry dog food, 12 kg", unit_price_cents: 5_000, quantity: 1, category: "dog-food" }],
    });
    expect(data).toMatchObject({ decision: "needs_approval", status: "pending_approval" });
    expect(JSON.stringify(data)).not.toMatch(/eyJ|token|https?:/);
  });

  it("request_payment first voids approvals left past their timeout, so their budget is free again", async () => {
    const { paypal, mandate } = await setup();
    let at = now;
    const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees, clock: () => at };
    const dogFood = { title: "Dry dog food, 12 kg", unit_price_cents: 5_000, quantity: 1, category: "dog-food" };
    const waiting = await requestPaymentTool(deps, mandate.id, { payee_merchant_id: SHOP_B, items: [dogFood] });
    if (!("payment_id" in waiting)) throw new Error("expected a payment");
    expect(waiting.status).toBe("pending_approval");

    at = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await requestPaymentTool(deps, mandate.id, { payee_merchant_id: SHOP_A, items: [coffee] });
    const [stale] = await db.select().from(payments).where(eq(payments.id, waiting.payment_id));
    expect(stale!.status).toBe("voided");
  });

  it("a malformed cart is reported back, not charged", async () => {
    const { handler, key } = await setup();
    const client = await connect(handler, key);
    const { data } = await call(client, "request_payment", { payee_merchant_id: SHOP_A, items: [{ ...coffee, category: "Dog Food!" }] });
    expect(data.error).toBe("invalid_cart");
    expect(await db.select().from(payments)).toEqual([]);
  });

  it("revoke_mandate stops all further payments", async () => {
    const { handler, key, paypal } = await setup();
    const client = await connect(handler, key);
    expect((await call(client, "revoke_mandate")).data).toMatchObject({ revoked: true, already_revoked: false });
    const { data } = await call(client, "request_payment", { payee_merchant_id: SHOP_A, items: [coffee] });
    expect(data).toMatchObject({ decision: "deny", clause_id: "mandate.revoked" });
    expect(paypal.calls).toEqual([]);
  });
});
