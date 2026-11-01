import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { ledgerEvents, mandates, payments, reservations } from "@/db/schema";
import { evaluate, type Evaluation } from "@/lib/policy/evaluate";
import type { BudgetPeriod, Cart, Policy } from "@/lib/policy/schema";
import { windowStart } from "@/lib/policy/windows";
import { cartIdempotencyKey } from "./idempotency";

export type Payment = typeof payments.$inferSelect;

export type DecideInput = {
  mandateId: string;
  runId: string | null;
  source: "agent" | "mcp";
  /** Must already be validated with cartSchema. */
  cart: Cart;
  now?: Date;
};

export type DecideResult = {
  payment: Payment;
  evaluation: Pick<Evaluation, "decision" | "clause" | "totalCents" | "checks">;
  /** True when this cart was already decided earlier; nothing new was reserved. */
  replayed: boolean;
};

export class MandateNotFoundError extends Error {}

async function spentByPeriod(tx: Tx, mandateId: string, policy: Policy, runId: string | null, now: Date) {
  const spent: Partial<Record<BudgetPeriod, number>> = {};
  const live = inArray(reservations.status, ["held", "captured"]);
  for (const { period } of policy.budgets) {
    let scope;
    if (period === "run") {
      // Ad-hoc requests have no run, so a per-run budget caps each one on its own.
      if (runId === null) {
        spent.run = 0;
        continue;
      }
      scope = eq(reservations.runId, runId);
    } else {
      scope = gte(reservations.createdAt, windowStart(period, now, policy.timezone)!);
    }
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${reservations.amountCents}), 0)` })
      .from(reservations)
      .where(and(eq(reservations.mandateId, mandateId), live, scope));
    spent[period] = Number(row?.total ?? 0);
  }
  return spent;
}

/**
 * Evaluates a cart against its mandate and, unless denied, reserves the budget, atomically.
 * The mandate row is locked for the duration, so concurrent requests on one mandate are serialised
 * and can't each see the same unspent budget. PayPal is called afterwards, outside this transaction.
 */
export async function decideAndReserve(db: Db, input: DecideInput): Promise<DecideResult> {
  const now = input.now ?? new Date();
  const key = cartIdempotencyKey({ mandateId: input.mandateId, cart: input.cart, runId: input.runId, now });

  return db.transaction(async (tx) => {
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, input.mandateId)).for("update");
    if (!mandate) throw new MandateNotFoundError(input.mandateId);

    const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key));
    if (existing) {
      return {
        payment: existing,
        evaluation: {
          decision: existing.decision,
          clause: { id: existing.clauseId as Evaluation["clause"]["id"], text: existing.clauseText },
          totalCents: existing.totalCents,
          checks: existing.checks,
        },
        replayed: true,
      };
    }

    const spent = await spentByPeriod(tx, mandate.id, mandate.policy, input.runId, now);
    const evaluation = evaluate({ policy: mandate.policy, mandateStatus: mandate.status, cart: input.cart, spent, now });

    const [payment] = await tx
      .insert(payments)
      .values({
        mandateId: mandate.id,
        mandateHash: mandate.hash,
        runId: input.runId,
        idempotencyKey: key,
        source: input.source,
        payeeMerchantId: input.cart.payeeMerchantId,
        items: input.cart.items,
        shippingCents: input.cart.shippingCents,
        taxCents: input.cart.taxCents,
        totalCents: evaluation.totalCents,
        currency: input.cart.currency,
        decision: evaluation.decision,
        clauseId: evaluation.clause.id,
        clauseText: evaluation.clause.text,
        checks: evaluation.checks,
        status: evaluation.decision === "deny" ? "denied" : "authorizing",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (evaluation.decision !== "deny") {
      await tx.insert(reservations).values({
        paymentId: payment!.id,
        mandateId: mandate.id,
        runId: input.runId,
        amountCents: evaluation.totalCents,
        createdAt: now,
      });
    }

    await tx.insert(ledgerEvents).values({
      mandateId: mandate.id,
      mandateHash: mandate.hash,
      paymentId: payment!.id,
      type: `decision.${evaluation.decision}`,
      amountCents: evaluation.totalCents,
      detail: { clause: evaluation.clause, spent },
      createdAt: now,
    });

    return { payment: payment!, evaluation, replayed: false };
  });
}

/** Returns reserved budget to the mandate, e.g. after a void, a rejected approval or a failed authorization. */
export async function releaseReservation(db: Db | Tx, paymentId: string, now = new Date()): Promise<boolean> {
  const released = await db
    .update(reservations)
    .set({ status: "released", settledAt: now })
    .where(and(eq(reservations.paymentId, paymentId), eq(reservations.status, "held")))
    .returning({ id: reservations.id });
  return released.length > 0;
}

export async function settleReservation(db: Db | Tx, paymentId: string, now = new Date()): Promise<boolean> {
  const settled = await db
    .update(reservations)
    .set({ status: "captured", settledAt: now })
    .where(and(eq(reservations.paymentId, paymentId), eq(reservations.status, "held")))
    .returning({ id: reservations.id });
  return settled.length > 0;
}
