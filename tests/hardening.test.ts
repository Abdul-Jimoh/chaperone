import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mandates, paymentMethods, payments, rateLimits, users } from "@/db/schema";
import { approvalLinkFor, confirmDemoMandate, createDemoAgentKey, revokeOwnMandate, simulatePurchase, startDemoShopper, type DemoWorld } from "@/lib/app/demo";
import type { ApprovalDeps } from "@/lib/payments/approvals";
import { httpsCertLoader } from "@/lib/paypal/webhooks";
import { clientId, LIMITS, RateLimitedError, type Limit } from "@/lib/ratelimit";
import { handleMcpRequest } from "@/mcp/http";
import { issueAgentKey } from "@/mcp/keys";
import { requestPaymentTool } from "@/mcp/tools";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B } from "./support/fixtures";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SHOP_C = "SHOPCCCCCCCCC";
const world: DemoWorld = {
  shops: [
    { key: "corner-market", name: "Corner Market", merchantId: SHOP_A, sells: "" },
    { key: "pet-pantry", name: "Pet Pantry", merchantId: SHOP_B, sells: "" },
    { key: "home-basics", name: "Home Basics", merchantId: SHOP_C, sells: "" },
  ],
  rogueMerchantId: ROGUE,
};

let jwk: JWK;
beforeAll(async () => {
  jwk = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
});

async function seedTemplateWallet() {
  const [template] = await db.insert(users).values({ email: "demo-shopper@example.com", displayName: "Demo shopper" }).returning();
  await db.insert(paymentMethods).values({ userId: template!.id, paypalPaymentTokenId: "VAULT-TEST-1" });
}

function deps(): ApprovalDeps & { paypal: ReturnType<typeof fakePayPal> } {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
  return { db, platform: paypal.platform, payees: paypal.payees, approvalSecret: "test-approval-secret-at-least-32-characters-long", paypal };
}

/** Puts a bucket at its limit for the current window, as if it had been used up. */
async function exhaust(limit: Limit, subject: string | null) {
  const start = Math.floor(Date.now() / limit.windowMs) * limit.windowMs;
  await db.insert(rateLimits).values({ bucket: subject === null ? limit.name : `${limit.name}:${subject}`, windowStart: new Date(start), hits: limit.max });
}

describe("demo limits", () => {
  it("stops one visitor starting more shoppers, without stopping anyone else", async () => {
    await seedTemplateWallet();
    await exhaust(LIMITS.demoStartPerClientDaily, "visitor-a");
    await expect(startDemoShopper(db, "visitor-a")).rejects.toBeInstanceOf(RateLimitedError);
    await expect(startDemoShopper(db, "visitor-b")).resolves.toEqual(expect.any(String));
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("one visitor's daily allowance can't reach the global caps", () => {
    expect(LIMITS.purchasesPerClientDaily.max * 30).toBeLessThanOrEqual(LIMITS.purchasesAll.max);
    expect(LIMITS.demoStartPerClientDaily.max * 50).toBeLessThanOrEqual(LIMITS.demoStartAll.max);
  });

  it("a visitor's purchase allowance covers all their shoppers, old ones included", async () => {
    await seedTemplateWallet();
    const d = deps();
    const old = await startDemoShopper(db, "visitor-a");
    await confirmDemoMandate(db, world, old, jwk);
    const fresh = await startDemoShopper(db, "visitor-a");
    await confirmDemoMandate(db, world, fresh, jwk);
    const other = await startDemoShopper(db, "visitor-b");
    await confirmDemoMandate(db, world, other, jwk);
    await exhaust(LIMITS.purchasesPerClientDaily, "visitor-a");
    await expect(simulatePurchase(d, world, old, "allowed", randomUUID())).rejects.toBeInstanceOf(RateLimitedError);
    await expect(simulatePurchase(d, world, fresh, "allowed", randomUUID())).rejects.toBeInstanceOf(RateLimitedError);
    await expect(simulatePurchase(d, world, other, "allowed", randomUUID())).resolves.toMatchObject({ ok: true });
  });

  it("limits demo starts per hour and approval links per shopper", async () => {
    await seedTemplateWallet();
    const d = deps();
    for (let i = 0; i < LIMITS.demoStartPerClient.max; i++) await startDemoShopper(db, "busy");
    await expect(startDemoShopper(db, "busy")).rejects.toBeInstanceOf(RateLimitedError);
    const id = await startDemoShopper(db, "calm");
    await confirmDemoMandate(db, world, id, jwk);
    const r = await simulatePurchase(d, world, id, "ask", randomUUID());
    if (!r.ok) throw new Error("invalid cart");
    await exhaust(LIMITS.approvalLinksPerShopper, id);
    await expect(approvalLinkFor(d, id, r.payment.id)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("the simulator and an MCP agent draw on the same purchase allowance", async () => {
    await seedTemplateWallet();
    const d = deps();
    const id = await startDemoShopper(db, "visitor");
    const mandate = await confirmDemoMandate(db, world, id, jwk);
    await exhaust(LIMITS.purchasesPerShopperDaily, id);
    await expect(simulatePurchase(d, world, id, "allowed", randomUUID())).rejects.toBeInstanceOf(RateLimitedError);
    const viaAgent = await requestPaymentTool(d, mandate.id, {
      payee_merchant_id: SHOP_B,
      items: [{ title: "Dry dog food, 12 kg", unit_price_cents: 2_649, quantity: 1, category: "dog-food" }],
    });
    expect(viaAgent).toMatchObject({ error: "rate_limited" });
    expect(await db.select().from(payments)).toEqual([]);
    expect(d.paypal.ops()).toEqual([]);
  });

  it("a confirm-and-revoke loop can't write mandates without end", async () => {
    await seedTemplateWallet();
    const d = deps();
    const id = await startDemoShopper(db, "visitor");
    for (let i = 0; i < LIMITS.mandatesPerShopper.max; i++) {
      await confirmDemoMandate(db, world, id, jwk);
      await revokeOwnMandate(d, id);
    }
    await expect(confirmDemoMandate(db, world, id, jwk)).rejects.toBeInstanceOf(RateLimitedError);
    expect(await db.select().from(mandates)).toHaveLength(LIMITS.mandatesPerShopper.max);
  });

  it("caps agent keys per shopper", async () => {
    await seedTemplateWallet();
    const id = await startDemoShopper(db, "visitor");
    await confirmDemoMandate(db, world, id, jwk);
    for (let i = 0; i < LIMITS.agentKeysPerShopper.max; i++) await createDemoAgentKey(db, id);
    await expect(createDemoAgentKey(db, id)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("visitor identity", () => {
  const secret = "secret-one-that-is-long-enough-000";
  it("counts an IPv6 /56 as one visitor, however the address is written", () => {
    const a = clientId("2001:db8:1:2::1", secret);
    expect(clientId("2001:0db8:0001:0002:0000:0000:0000:0009", secret)).toBe(a);
    expect(clientId("2001:db8:1:ff:ffff:1:2:3", secret)).toBe(a);
    expect(clientId("[2001:DB8:1:2::1]", secret)).toBe(a);
    expect(clientId("2001:db8:1:100::1", secret)).not.toBe(a);
    expect(clientId("2001:db8:2:2::1", secret)).not.toBe(a);
  });

  it("counts IPv4 addresses one by one, including when written as IPv4-mapped IPv6", () => {
    expect(clientId("203.0.113.7", secret)).not.toBe(clientId("203.0.113.8", secret));
    expect(clientId("::ffff:203.0.113.7", secret)).toBe(clientId("203.0.113.7", secret));
    expect(clientId("0:0:0:0:0:ffff:203.0.113.7", secret)).toBe(clientId("203.0.113.7", secret));
    expect(clientId("::ffff:198.51.100.1", secret)).not.toBe(clientId("::ffff:203.0.113.7", secret));
  });
});

describe("MCP batches", () => {
  it("refuses a JSON-RPC batch, so one request can't carry many calls", async () => {
    await seedTemplateWallet();
    const id = await startDemoShopper(db, "visitor");
    const mandate = await confirmDemoMandate(db, world, id, jwk);
    const key = await issueAgentKey(db, mandate.id, "test");
    const call = (n: number) => ({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: "list_spend", arguments: {} } });
    const res = await handleMcpRequest(
      new Request("https://chaperone.test/api/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(Array.from({ length: 50 }, (_, i) => call(i))),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
  });
});

describe("webhook certificate cache", () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const cert = { validFrom: "Jan 1 00:00:00 2020 GMT", validTo: "Jan 1 00:00:00 2099 GMT", publicKey: createPublicKey(publicKey.export({ type: "spki", format: "pem" })) };
  it("ignores the query string and stays bounded", async () => {
    const fetchImpl = vi.fn(async () => new Response("pem")) as unknown as typeof fetch;
    const load = httpsCertLoader(fetchImpl, () => cert);
    const now = new Date();
    await load(new URL("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?a=1"), now);
    await load(new URL("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?a=2"), now);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).not.toContain("?");
    for (let i = 0; i < 20; i++) await load(new URL(`https://api.sandbox.paypal.com/v1/notifications/certs/C-${i}`), now);
    await load(new URL("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1"), now);
    expect(fetchImpl).toHaveBeenCalledTimes(22);
  });
});
