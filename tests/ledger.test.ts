import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { paymentMethods, users } from "@/db/schema";
import { simulatePurchase, startDemoShopper, type DemoWorld } from "@/lib/app/demo";
import { ledgerFor } from "@/lib/app/ledger";
import type { ApprovalDeps } from "@/lib/payments/approvals";
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

let jwk: JWK;
beforeAll(async () => {
  jwk = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
});

describe("ledger", () => {
  it("shows a shopper only their own payments, each with its mandate hash and trail", async () => {
    const [template] = await db.insert(users).values({ email: "demo-shopper@example.com", displayName: "Demo shopper" }).returning();
    await db.insert(paymentMethods).values({ userId: template!.id, paypalPaymentTokenId: "VAULT-DEMO" });
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
    const deps: ApprovalDeps = { db, platform: paypal.platform, payees: paypal.payees, approvalSecret: "test-approval-secret-at-least-32-characters-long" };

    const amara = await startDemoShopper(db, randomUUID());
    const other = await startDemoShopper(db, randomUUID());
    const mine = await confirmExample(db, world, amara, jwk);
    await confirmExample(db, world, other, jwk);
    await simulatePurchase(deps, world, amara, "allowed", randomUUID());
    await simulatePurchase(deps, world, amara, "injected", randomUUID());
    await simulatePurchase(deps, world, other, "ask", randomUUID());

    const rows = await ledgerFor(db, amara);
    expect(rows.map((r) => [r.shop, r.decision, r.status]).sort()).toEqual([
      ["A shop not on your list", "deny", "denied"],
      ["Pet Pantry", "allow", "captured"],
    ]);
    expect(rows.every((r) => r.mandateHash === mine.hash)).toBe(true);
    const paid = rows.find((r) => r.status === "captured")!;
    expect(paid.events.map((e) => e.type)).toEqual(expect.arrayContaining(["decision.allow", "hold.placed", "capture.completed"]));
    expect(await ledgerFor(db, randomUUID())).toEqual([]);
  });
});
