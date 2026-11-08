import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerEvents, mandates, paymentMethods, payments, users } from "@/db/schema";
import {
  approvalLinkFor,
  dashboard,
  DemoNotReadyError,
  exampleReadBack,
  NotYoursError,
  revokeOwnMandate,
  simulatePurchase,
  startDemoShopper,
  type DemoWorld,
} from "@/lib/app/demo";
import type { ApprovalDeps } from "@/lib/payments/approvals";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B } from "./support/fixtures";
import { confirmExample } from "./support/demo";

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

function setup() {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
  const deps: ApprovalDeps = { db, platform: paypal.platform, payees: paypal.payees, approvalSecret: "test-approval-secret-at-least-32-characters-long" };
  return { paypal, deps };
}

async function shopper() {
  const id = await startDemoShopper(db, "test-client");
  await confirmExample(db, world, id, jwk);
  return id;
}

describe("judge-mode demo", () => {
  it("doesn't list the schedule among the rules it checks, because the evaluator doesn't check it", () => {
    const back = exampleReadBack(world, randomUUID(), "test-draft-secret");
    expect(back.rules.some((r) => /every 2 weeks/i.test(r))).toBe(false);
    expect(back.notEnforced.some((r) => /every 2 weeks/i.test(r))).toBe(true);
  });

  it("refuses to start before the shared sandbox wallet is seeded", async () => {
    await expect(startDemoShopper(db, "test-client")).rejects.toBeInstanceOf(DemoNotReadyError);
  });

  it("gives each visitor their own shopper, mandate and ledger, sharing only the sandbox wallet", async () => {
    await seedTemplateWallet();
    const { deps } = setup();
    const [a, b] = [await shopper(), await shopper()];
    expect(a).not.toBe(b);
    const wallets = await db.select().from(paymentMethods);
    expect(new Set(wallets.map((w) => w.paypalPaymentTokenId))).toEqual(new Set(["VAULT-TEST-1"]));

    await simulatePurchase(deps, world, a, "allowed", randomUUID());
    expect((await dashboard(db, a))!.recent).toHaveLength(1);
    expect((await dashboard(db, b))!.recent).toHaveLength(0);
  });

  it("confirming twice keeps a single active mandate", async () => {
    await seedTemplateWallet();
    const id = await shopper();
    await confirmExample(db, world, id, jwk);
    expect(await db.select().from(mandates).where(eq(mandates.userId, id))).toHaveLength(1);
  });

  it("the three demo carts are captured, held for the user, and blocked before PayPal", async () => {
    await seedTemplateWallet();
    const { deps, paypal } = setup();
    const id = await shopper();
    const statuses = [];
    for (const s of ["allowed", "ask", "injected"] as const) {
      const r = await simulatePurchase(deps, world, id, s, randomUUID());
      if (!r.ok) throw new Error("invalid cart");
      statuses.push([r.decision, r.payment.status, r.clause.id]);
    }
    expect(statuses).toEqual([
      ["allow", "captured", "within_limits"],
      ["needs_approval", "pending_approval", "approval.threshold"],
      ["deny", "denied", "payee.allowlist"],
    ]);
    expect(paypal.ops().filter((o) => o.startsWith("order"))).toHaveLength(2);
  });

  it("a double-click or resent form is one purchase, a new attempt is another", async () => {
    await seedTemplateWallet();
    const { deps, paypal } = setup();
    const id = await shopper();
    const attempt = randomUUID();
    const [first, again] = await Promise.all([
      simulatePurchase(deps, world, id, "allowed", attempt),
      simulatePurchase(deps, world, id, "allowed", attempt),
    ]);
    expect(first.ok && again.ok && first.payment.id === again.payment.id).toBe(true);
    expect(paypal.ops().filter((o) => o.startsWith("order"))).toHaveLength(1);
    await simulatePurchase(deps, world, id, "allowed", randomUUID());
    expect(await db.select().from(payments)).toHaveLength(2);
  });

  it("issues an approval link only to the payment's owner", async () => {
    await seedTemplateWallet();
    const { deps } = setup();
    const [owner, stranger] = [await shopper(), await shopper()];
    const r = await simulatePurchase(deps, world, owner, "ask", randomUUID());
    if (!r.ok) throw new Error("invalid cart");
    await expect(approvalLinkFor(deps, stranger, r.payment.id)).rejects.toBeInstanceOf(NotYoursError);
    expect((await approvalLinkFor(deps, owner, r.payment.id))?.token).toMatch(/^ey/);
  });

  it("revoking from the dashboard cancels the waiting hold and records that the user did it", async () => {
    await seedTemplateWallet();
    const { deps } = setup();
    const id = await shopper();
    const r = await simulatePurchase(deps, world, id, "ask", randomUUID());
    if (!r.ok) throw new Error("invalid cart");
    expect(await revokeOwnMandate(deps, id)).toMatchObject({ voided: [r.payment.id], stillOpen: [] });
    const [p] = await db.select().from(payments).where(eq(payments.id, r.payment.id));
    expect(p!.status).toBe("voided");
    const [event] = await db.select().from(ledgerEvents).where(eq(ledgerEvents.type, "mandate.revoked"));
    expect(event!.detail).toEqual({ by: "user" });
    const next = await simulatePurchase(deps, world, id, "allowed", randomUUID());
    expect(next.ok && next.decision).toBe("deny");
  });
});
