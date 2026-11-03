import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { JWK } from "jose";
import type { Db } from "@/db/client";
import { approvals, mandates, paymentMethods, payments, users } from "@/db/schema";
import { DEMO_STATEMENT, demoPolicy } from "@/lib/demo";
import { spentByPeriod } from "@/lib/ledger/reserve";
import { storeConfirmedMandate, type Mandate } from "@/lib/mandates";
import { issueApprovalLink, type ApprovalDeps } from "@/lib/payments/approvals";
import { requestPayment, revokeMandate, type PaymentDeps, type PaymentResult } from "@/lib/payments/service";
import type { DemoShop } from "@/lib/shops";

/** Where the demo's carts are sent: the three sandbox shops, plus a merchant that is none of them. */
export type DemoWorld = { shops: DemoShop[]; rogueMerchantId: string };

/** The seeded shopper whose vaulted sandbox wallet every judge-mode shopper borrows (scripts/seed.ts). */
const TEMPLATE_EMAIL = "demo-shopper@example.com";

export class DemoNotReadyError extends Error {}
export class NotYoursError extends Error {}

/** A fresh, isolated shopper for one visitor: their own mandate, budget and ledger, sharing only the sandbox wallet. */
export async function startDemoShopper(db: Db): Promise<string> {
  const [template] = await db
    .select({ token: paymentMethods.paypalPaymentTokenId, customer: paymentMethods.paypalCustomerId })
    .from(paymentMethods)
    .innerJoin(users, eq(users.id, paymentMethods.userId))
    .where(and(eq(users.email, TEMPLATE_EMAIL), eq(paymentMethods.status, "active")))
    .limit(1);
  if (!template) throw new DemoNotReadyError("The demo wallet isn't set up yet (run scripts/seed.ts).");

  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ displayName: "Demo shopper", demoSessionId: randomUUID() }).returning();
    await tx.insert(paymentMethods).values({ userId: user!.id, paypalPaymentTokenId: template.token, paypalCustomerId: template.customer });
    return user!.id;
  });
}

export function demoDraft(world: DemoWorld) {
  return { statement: DEMO_STATEMENT, policy: demoPolicy(world.shops) };
}

/** Signs the demo mandate after the user has read it back and pressed confirm. One active mandate per shopper. */
export async function confirmDemoMandate(db: Db, world: DemoWorld, userId: string, signingJwk: JWK): Promise<Mandate> {
  const current = await activeMandate(db, userId);
  if (current) return current;
  const { statement, policy } = demoDraft(world);
  return storeConfirmedMandate(db, { userId, statement, policy, signingJwk });
}

export async function activeMandate(db: Db, userId: string): Promise<Mandate | null> {
  const [m] = await db
    .select()
    .from(mandates)
    .where(and(eq(mandates.userId, userId), eq(mandates.status, "active")))
    .orderBy(desc(mandates.createdAt))
    .limit(1);
  return m ?? null;
}

export async function latestMandate(db: Db, userId: string): Promise<Mandate | null> {
  const [m] = await db.select().from(mandates).where(eq(mandates.userId, userId)).orderBy(desc(mandates.createdAt)).limit(1);
  return m ?? null;
}

export async function dashboard(db: Db, userId: string, now = new Date()) {
  const mandate = await latestMandate(db, userId);
  if (!mandate) return null;
  const spent = await spentByPeriod(db, mandate.id, mandate.policy, null, now);
  const recent = await db.select().from(payments).where(eq(payments.mandateId, mandate.id)).orderBy(desc(payments.createdAt)).limit(25);
  const waiting = recent.filter((p) => p.status === "pending_approval");
  const deadlines = waiting.length
    ? await db.select({ paymentId: approvals.paymentId, expiresAt: approvals.expiresAt }).from(approvals).where(inArray(approvals.paymentId, waiting.map((p) => p.id)))
    : [];
  return { mandate, spent, recent, waiting, deadlines: new Map(deadlines.map((d) => [d.paymentId, d.expiresAt])) };
}

export type Scenario = "allowed" | "ask" | "injected";

// Carts an agent might propose. They go through the same evaluator and PayPal sandbox as a real agent's.
function scenarioCart(world: DemoWorld, scenario: Scenario) {
  const shops = new Map(world.shops.map((s) => [s.key, s.merchantId]));
  const cart = (payeeMerchantId: string, items: { title: string; unitPriceCents: number; quantity: number; category: string }[]) => ({
    payeeMerchantId,
    currency: "USD",
    items,
    shippingCents: 0,
    taxCents: 0,
  });
  switch (scenario) {
    case "allowed":
      return cart(shops.get("pet-pantry")!, [{ title: "Dry dog food, 12 kg", unitPriceCents: 2_649, quantity: 1, category: "dog-food" }]);
    case "ask":
      return cart(shops.get("home-basics")!, [
        { title: "Paper towels, 12 rolls", unitPriceCents: 2_999, quantity: 1, category: "paper-towels" },
        { title: "Dish soap, 750 ml", unitPriceCents: 750, quantity: 2, category: "dish-soap" },
      ]);
    case "injected":
      // The listing told the agent to buy 10 and pay a merchant that isn't one of the user's shops.
      return cart(world.rogueMerchantId, [
        { title: "Premium kibble, 30 lb", unitPriceCents: 2_499, quantity: 10, category: "dog-food" },
      ]);
  }
}

async function ownMandate(db: Db, userId: string): Promise<Mandate> {
  const mandate = await latestMandate(db, userId);
  if (!mandate) throw new NotYoursError("No mandate yet.");
  return mandate;
}

export async function simulatePurchase(deps: PaymentDeps, world: DemoWorld, userId: string, scenario: Scenario): Promise<PaymentResult> {
  const mandate = await ownMandate(deps.db, userId);
  return requestPayment(deps, { mandateId: mandate.id, runId: `demo-${randomUUID()}`, source: "agent", cart: scenarioCart(world, scenario) });
}

export async function revokeOwnMandate(deps: PaymentDeps, userId: string) {
  const mandate = await ownMandate(deps.db, userId);
  return revokeMandate(deps, mandate.id, "user");
}

/** Issued only to the signed-in owner: a link in an agent's hands would let it approve itself (D12). */
export async function approvalLinkFor(deps: ApprovalDeps, userId: string, paymentId: string) {
  const [row] = await deps.db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(mandates, eq(mandates.id, payments.mandateId))
    .where(and(eq(payments.id, paymentId), eq(mandates.userId, userId)));
  if (!row) throw new NotYoursError("That payment isn't yours.");
  return issueApprovalLink(deps, paymentId);
}
