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

const RETRYABLE: Payment["status"][] = ["voided", "failed"];

function attemptKey(base: string, attempt: number): string {
  return attempt === 1 ? base : `${base}:${attempt}`;
}

/** Cents reserved or captured in each of the policy's budget windows: the same numbers the evaluator is given. */
export async function spentByPeriod(tx: Db | Tx, mandateId: string, policy: Policy, runId: string | null, now: Date) {
  const spent: Partial<Record<BudgetPeriod, number>> = {};
  const live = inArray(reservations.status, ["held", "captured"]);
  for (const { period } of policy.budgets) {
    let scope;
    if (period === "run") {
      // Only direct calls without a run (tests, scripts) get here with null; MCP requests carry mcpRunId.
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
  const base = cartIdempotencyKey({ mandateId: input.mandateId, cart: input.cart, runId: input.runId, now });

  return db.transaction(async (tx) => {
    // NO KEY UPDATE, never FOR UPDATE, on mandates and payments: these locks still exclude each other,
    // but don't block the KEY SHARE lock every ledger/reservation insert takes on its foreign keys,
    // which deadlocked a capture claim against a capture completion.
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, input.mandateId)).for("no key update");
    if (!mandate) throw new MandateNotFoundError(input.mandateId);

    // A cart whose hold was voided (rejected, expired, revoked) or never placed paid nothing, so sending it again
    // is a new purchase; anything else under the same key is the same purchase and is replayed.
    let key = base;
    let existing: Payment | undefined;
    for (let attempt = 1; ; attempt++) {
      key = attemptKey(base, attempt);
      [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key));
      if (!existing || !RETRYABLE.includes(existing.status)) break;
    }
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
