import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerEvents, payments, reservations } from "@/db/schema";
import { decideAndReserve, releaseReservation, settleReservation } from "@/lib/ledger/reserve";
import { resetDb, seedMandate, testDb } from "./support/db";
import { cart, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(20);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const now = new Date("2026-11-03T15:00:00Z");
const item = (n: number) => ({ productId: `p${n}`, title: `Coffee ${n}`, unitPriceCents: 4_000, quantity: 1, category: "coffee" });

describe("decideAndReserve", () => {
  it("reserves the budget for an allowed cart and records the mandate hash", async () => {
    const mandate = await seedMandate(db, samplePolicy());
    const r = await decideAndReserve(db, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart(), now });
    expect(r.evaluation.decision).toBe("allow");
    expect(r.payment.status).toBe("authorizing");
    expect(r.payment.mandateHash).toBe(mandate.hash);
    const [res] = await db.select().from(reservations).where(eq(reservations.paymentId, r.payment.id));
    expect(res).toMatchObject({ amountCents: 1_800, status: "held" });
    const events = await db.select().from(ledgerEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "decision.allow", mandateHash: mandate.hash });
  });

  it("records a denial without reserving anything", async () => {
    const mandate = await seedMandate(db, samplePolicy(), "revoked");
    const r = await decideAndReserve(db, { mandateId: mandate.id, runId: null, source: "mcp", cart: cart(), now });
    expect(r.payment.status).toBe("denied");
    expect(r.payment.clauseId).toBe("mandate.revoked");
    expect(await db.select().from(reservations)).toHaveLength(0);
  });

  it("can't be overspent by parallel requests", async () => {
    // $150/month, $40 carts, no per-run limit: exactly three fit.
    const mandate = await seedMandate(db, samplePolicy({ budgets: [{ period: "month", limitCents: 15_000 }], approvalThresholdCents: null }));
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        decideAndReserve(db, { mandateId: mandate.id, runId: `run-${n}`, source: "mcp", cart: cart({ items: [item(n)] }), now }),
      ),
    );
    const allowed = results.filter((r) => r.evaluation.decision === "allow");
    expect(allowed).toHaveLength(3);
    expect(results.filter((r) => r.evaluation.clause.id === "budget.month")).toHaveLength(9);
    const held = await db.select().from(reservations);
    expect(held.reduce((s, r) => s + r.amountCents, 0)).toBe(12_000);
  });

  it("dedupes a retried cart, even when the retries race", async () => {
    const mandate = await seedMandate(db, samplePolicy());
    const input = { mandateId: mandate.id, runId: "run-1", source: "agent" as const, cart: cart(), now };
    const results = await Promise.all(Array.from({ length: 5 }, () => decideAndReserve(db, input)));
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
    expect(await db.select().from(reservations)).toHaveLength(1);
  });

  it("enforces the per-run budget across carts in the same run only", async () => {
    const mandate = await seedMandate(db, samplePolicy({ approvalThresholdCents: null }));
    const go = (n: number, runId: string) =>
      decideAndReserve(db, { mandateId: mandate.id, runId, source: "agent", cart: cart({ items: [item(n)] }), now });
    expect((await go(1, "run-1")).evaluation.decision).toBe("allow");
    expect((await go(2, "run-1")).evaluation.decision).toBe("allow");
    expect((await go(3, "run-1")).evaluation.clause.id).toBe("budget.run");
    expect((await go(4, "run-2")).evaluation.decision).toBe("allow");
  });

  it("gives budget back when a hold is released, but not when it's captured", async () => {
    const mandate = await seedMandate(db, samplePolicy({ budgets: [{ period: "month", limitCents: 8_000 }], approvalThresholdCents: null }));
    const go = (n: number) =>
      decideAndReserve(db, { mandateId: mandate.id, runId: `run-${n}`, source: "agent", cart: cart({ items: [item(n)] }), now });
    const first = await go(1);
    const second = await go(2);
    expect((await go(3)).evaluation.clause.id).toBe("budget.month");

    expect(await releaseReservation(db, first.payment.id)).toBe(true);
    expect(await releaseReservation(db, first.payment.id)).toBe(false);
    expect(await settleReservation(db, second.payment.id)).toBe(true);
    expect((await go(4)).evaluation.decision).toBe("allow");
    expect((await go(5)).evaluation.clause.id).toBe("budget.month");
  });
});
