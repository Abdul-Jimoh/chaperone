import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerEvents, payments, reservations } from "@/db/schema";
import { approvalLinkFor, NotYoursError } from "@/lib/app/demo";
import { decideApproval, issueApprovalLink, sweepApprovals, type ApprovalDeps } from "@/lib/payments/approvals";
import { MAX_CAPTURE_ATTEMPTS, requestPayment, type PaymentResult } from "@/lib/payments/service";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { cart, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(10);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SECRET = "test-approval-secret-at-least-32-characters-long";
const DECLINED = { status: 422, name: "UNPROCESSABLE_ENTITY", issue: "INSTRUMENT_DECLINED" };

function setup() {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
  const clock = { now: new Date("2026-11-03T15:00:00Z") };
  const deps: ApprovalDeps = { db, platform: paypal.platform, payees: paypal.payees, approvalSecret: SECRET, clock: () => clock.now };
  const advance = (minutes: number) => (clock.now = new Date(clock.now.getTime() + minutes * 60_000));
  return { paypal, deps, advance };
}

const bigCart = () =>
  cart({ payeeMerchantId: SHOP_B, items: [{ productId: "kibble-12kg", title: "Dry dog food, 12 kg", unitPriceCents: 5_000, quantity: 1, category: "dog-food" }] });

function ok(result: PaymentResult) {
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result;
}

async function reservation(paymentId: string) {
  return (await db.select().from(reservations).where(eq(reservations.paymentId, paymentId)))[0]!.status;
}

async function approved(deps: ApprovalDeps) {
  const mandate = await seedLinkedMandate(db, samplePolicy());
  const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
  const link = (await issueApprovalLink(deps, payment.id))!;
  return { mandate, payment, link };
}

describe("a capture that doesn't go through", () => {
  it("is retried by the sweep after PayPal declines it on approval", async () => {
    const { paypal, deps, advance } = setup();
    const { payment, link } = await approved(deps);
    paypal.fail.capture = DECLINED;
    expect((await decideApproval(deps, link.token, "approve")).status).toBe("authorized");

    delete paypal.fail.capture;
    advance(3);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("captured");
    expect(await reservation(payment.id)).toBe("captured");
  });

  it("releases the hold and its budget after repeated declines", async () => {
    const { paypal, deps, advance } = setup();
    const { payment, link } = await approved(deps);
    paypal.fail.capture = DECLINED;
    await decideApproval(deps, link.token, "approve");
    for (let i = 1; i < MAX_CAPTURE_ATTEMPTS; i++) {
      advance(3);
      await sweepApprovals(deps);
    }
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
    const types = (await db.select().from(ledgerEvents).where(eq(ledgerEvents.paymentId, payment.id))).map((e) => e.type);
    expect(types.filter((t) => t === "capture.failed")).toHaveLength(MAX_CAPTURE_ATTEMPTS);
    expect(types).toContain("hold.voided");
  });

  it("is resumed with the same request id after the connection drops mid-capture", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    const [stuck] = await db.select().from(payments);
    expect(stuck!.status).toBe("capturing");

    delete paypal.fail.capture;
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("capturing");
    advance(3);
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
    expect(await reservation(stuck!.id)).toBe("captured");
    const captures = paypal.calls.filter((c) => c.op === "capture");
    expect(captures).toHaveLength(2);
  });
});

describe("buying a cart again", () => {
  it("asks again after the user rejected it, instead of replaying the rejection", async () => {
    const { deps } = setup();
    const { mandate, payment, link } = await approved(deps);
    expect((await decideApproval(deps, link.token, "reject")).status).toBe("voided");

    const again = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    expect(again).toMatchObject({ replayed: false, decision: "needs_approval" });
    expect(again.payment.id).not.toBe(payment.id);
    expect(again.payment.status).toBe("pending_approval");

    const retried = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    expect(retried).toMatchObject({ replayed: true });
    expect(retried.payment.id).toBe(again.payment.id);
  });
});

describe("approval links", () => {
  it("refuses a malformed payment id without touching the database", async () => {
    const { deps } = setup();
    const { mandate } = await approved(deps);
    await expect(approvalLinkFor(deps, mandate.userId, "not-a-uuid")).rejects.toBeInstanceOf(NotYoursError);
  });
});
