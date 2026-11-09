import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { paymentMethods, users } from "@/db/schema";
import { simulatePurchase, startDemoShopper, type DemoWorld } from "@/lib/app/demo";
import { finishWalletLink, startWalletLink, walletOf, WalletLinkError } from "@/lib/app/wallet";
import type { ApprovalDeps } from "@/lib/payments/approvals";
import { createPayPalClient } from "@/lib/paypal/client";
import { confirmExample } from "./support/demo";
import { resetDb, testDb } from "./support/db";
import { fakePayPal } from "./support/fake-paypal";
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
const secret = "test-approval-secret-at-least-32-characters-long";

let jwk: JWK;
beforeAll(async () => {
  jwk = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
});

async function setup() {
  const [template] = await db.insert(users).values({ email: "demo-shopper@example.com", displayName: "Demo shopper" }).returning();
  await db.insert(paymentMethods).values({ userId: template!.id, paypalPaymentTokenId: "VAULT-DEMO" });
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
  const deps: ApprovalDeps = { db, platform: paypal.platform, payees: paypal.payees, approvalSecret: secret };
  const wallet = { db, platform: paypal.platform, secret };
  const shopper = await startDemoShopper(db, randomUUID());
  return { paypal, deps, wallet, shopper };
}

describe("linking your own PayPal (Vault v3 via the JS SDK v6 button)", () => {
  it("starts on the shared demo wallet", async () => {
    const { shopper } = await setup();
    expect(await walletOf(db, shopper)).toEqual({ kind: "demo" });
  });

  it("an approved setup token becomes the wallet every later hold is placed on", async () => {
    const { paypal, deps, wallet, shopper } = await setup();
    const { setupToken, ticket } = await startWalletLink(wallet, shopper, "https://chaperone.test");
    expect(await finishWalletLink(wallet, shopper, setupToken, ticket)).toEqual({ kind: "own", email: "buyer@example.test" });
    expect(await walletOf(db, shopper)).toEqual({ kind: "own", email: "buyer@example.test" });

    await confirmExample(db, world, shopper, jwk);
    await simulatePurchase(deps, world, shopper, "allowed", randomUUID());
    const order = paypal.calls.find((c) => c.op === "order")!.body as { payment_source: { paypal: { vault_id: string } } };
    expect(order.payment_source.paypal.vault_id).toBe(`PT-${setupToken}`);
    const active = await db.select().from(paymentMethods).where(eq(paymentMethods.userId, shopper));
    expect(active.filter((m) => m.status === "active").map((m) => m.paypalPaymentTokenId)).toEqual([`PT-${setupToken}`]);
  });

  it("refuses a setup token started by a different shopper", async () => {
    const { paypal, wallet, shopper } = await setup();
    const other = await startDemoShopper(db, randomUUID());
    const theirs = await startWalletLink(wallet, other, "https://chaperone.test");
    await expect(finishWalletLink(wallet, shopper, theirs.setupToken, theirs.ticket)).rejects.toBeInstanceOf(WalletLinkError);
    const mine = await startWalletLink(wallet, shopper, "https://chaperone.test");
    await expect(finishWalletLink(wallet, shopper, theirs.setupToken, mine.ticket)).rejects.toBeInstanceOf(WalletLinkError);
    expect(paypal.calls.filter((c) => c.op === "vault")).toHaveLength(0);
    expect(await walletOf(db, shopper)).toEqual({ kind: "demo" });
  });

  it("refuses an expired ticket", async () => {
    const { wallet, shopper } = await setup();
    const { setupToken, ticket } = await startWalletLink(wallet, shopper, "https://chaperone.test", new Date(Date.now() - 16 * 60_000));
    await expect(finishWalletLink(wallet, shopper, setupToken, ticket)).rejects.toBeInstanceOf(WalletLinkError);
  });

  it("never holds on a revoked wallet, even when it is the newest row", async () => {
    const { paypal, deps, wallet, shopper } = await setup();
    const { setupToken, ticket } = await startWalletLink(wallet, shopper, "https://chaperone.test");
    await finishWalletLink(wallet, shopper, setupToken, ticket);
    await db.update(paymentMethods).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(paymentMethods.paypalPaymentTokenId, "VAULT-DEMO"));
    await confirmExample(db, world, shopper, jwk);
    await simulatePurchase(deps, world, shopper, "allowed", randomUUID());
    const order = paypal.calls.find((c) => c.op === "order")!.body as { payment_source: { paypal: { vault_id: string } } };
    expect(order.payment_source.paypal.vault_id).toBe(`PT-${setupToken}`);
  });

  it("only hands the browser a token PayPal scoped to the client SDK", async () => {
    const answer = (scope: string) => async () => Response.json({ access_token: "tok", expires_in: 900, scope });
    const sdk = createPayPalClient({ clientId: "x", clientSecret: "y", fetch: answer("https://uri.paypal.com/services/payments/client-payments-eligibility Braintree:Vault") });
    expect(await sdk.browserToken(["chaperone.test"])).toBe("tok");
    const full = createPayPalClient({ clientId: "x", clientSecret: "y", fetch: answer("https://uri.paypal.com/services/payments/realtimepayment Braintree:Vault") });
    await expect(full.browserToken(["chaperone.test"])).rejects.toThrow(/client SDK/);
    const none = createPayPalClient({ clientId: "x", clientSecret: "y", fetch: answer("") });
    await expect(none.browserToken(["chaperone.test"])).rejects.toThrow(/client SDK/);
  });

  it("finishing twice keeps one wallet and asks PayPal with the same request id", async () => {
    const { paypal, wallet, shopper } = await setup();
    const { setupToken, ticket } = await startWalletLink(wallet, shopper, "https://chaperone.test");
    await finishWalletLink(wallet, shopper, setupToken, ticket);
    await finishWalletLink(wallet, shopper, setupToken, ticket);
    const ids = paypal.calls.filter((c) => c.op === "vault").map((c) => c.requestId);
    expect(new Set(ids).size).toBe(1);
    const active = await db.select().from(paymentMethods).where(eq(paymentMethods.userId, shopper));
    expect(active.filter((m) => m.status === "active")).toHaveLength(1);
  });
});
