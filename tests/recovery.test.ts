import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerEvents, payments, reservations } from "@/db/schema";
import { approvalLinkFor, NotYoursError } from "@/lib/app/demo";
import { decideApproval, issueApprovalLink, sweepApprovals, type ApprovalDeps } from "@/lib/payments/approvals";
import { capturePayment, MAX_CAPTURE_ATTEMPTS, requestPayment, resumeStuckPayments, revokeMandate, type PaymentResult } from "@/lib/payments/service";
import { checkMandate } from "@/mcp/tools";
import { UnknownPayeeError } from "@/lib/paypal/payees";
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
    expect(captures[1]!.requestId).toBe(captures[0]!.requestId);
  });

  it("records a capture PayPal made but whose answer was lost, without capturing twice", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    advance(3);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments);
    // A new request id would have hit PayPal's "already captured" and logged a failure instead.
    expect(row).toMatchObject({ status: "captured", paypalCaptureId: "CAP-AUTH1" });
    expect(new Set(paypal.calls.filter((c) => c.op === "capture").map((c) => c.requestId)).size).toBe(1);
    const types = (await db.select().from(ledgerEvents).where(eq(ledgerEvents.paymentId, row!.id))).map((e) => e.type);
    expect(types).not.toContain("capture.failed");
  });

  it("asks PayPal before voiding an interrupted capture on a revoked mandate", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    await revokeMandate(deps, mandate.id);
    advance(3);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments);
    expect(row!.status).toBe("captured");
    expect(await reservation(row!.id)).toBe("captured");
    expect(paypal.calls.filter((c) => c.op === "void")).toEqual([]);
  });

  it("voids an interrupted capture on a revoked mandate when PayPal never captured it", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    await revokeMandate(deps, mandate.id);
    advance(3);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments);
    expect(row!.status).toBe("voided");
    expect(await reservation(row!.id)).toBe("released");
  });
});

describe("a hold whose answer from PayPal is unclear", () => {
  it("stays open after a PayPal 5xx, and is resumed with the same request id instead of a second hold", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = { status: 500, name: "INTERNAL_SERVER_ERROR", issue: "INTERNAL_SERVICE_ERROR" };
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("PayPal 500");
    expect((await db.select().from(payments))[0]!.status).toBe("authorizing");

    // Re-sent while the first is unresolved: the same purchase, not a new one.
    const again = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(again.replayed).toBe(true);

    delete paypal.fail.order;
    advance(3);
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
    const orders = paypal.calls.filter((c) => c.op === "order");
    expect(new Set(orders.map((c) => c.requestId)).size).toBe(1);
  });

  it("isn't placed twice when PayPal placed it but the answer was lost", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.order;
    advance(3);
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
    expect(paypal.auths.size).toBe(1);
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

describe("the sweep", () => {
  it("moves a row that keeps failing to the back, so it can't starve the others", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    const [broken] = await db.select().from(payments);
    // PayPal can't find it, so every attempt to resume it fails.
    await db.update(payments).set({ paypalAuthorizationId: "AUTH-MISSING" }).where(eq(payments.id, broken!.id));
    delete paypal.fail.capture;

    advance(1);
    paypal.fail.order = "network";
    const other = cart({ payeeMerchantId: SHOP_B, items: [{ productId: "kibble-2kg", title: "Dry dog food, 2 kg", unitPriceCents: 1_500, quantity: 1, category: "dog-food" }] });
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: other })).rejects.toThrow("fetch failed");
    delete paypal.fail.order;

    advance(3);
    await resumeStuckPayments(deps, { limit: 1 });
    await resumeStuckPayments(deps, { limit: 1 });
    const rows = await db.select().from(payments);
    expect(rows.find((r) => r.id === broken!.id)!.status).toBe("capturing");
    expect(rows.find((r) => r.id !== broken!.id)!.status).toBe("captured");
  });
});

describe("a denied cart", () => {
  it("is replayed, not decided again, the same day", async () => {
    const { deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const tooBig = cart({ items: [{ productId: "beans-1kg", title: "Whole bean coffee, 1 kg", unitPriceCents: 9_000, quantity: 1, category: "coffee" }] });
    const first = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: tooBig }));
    expect(first.decision).toBe("deny");
    const second = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: tooBig }));
    expect(second).toMatchObject({ replayed: true, decision: "deny" });
    expect(second.payment.id).toBe(first.payment.id);
    expect(await db.select().from(payments)).toHaveLength(1);
  });
});

describe("approval links", () => {
  it("refuses a malformed payment id without touching the database", async () => {
    const { deps } = setup();
    const { mandate } = await approved(deps);
    await expect(approvalLinkFor(deps, mandate.userId, "not-a-uuid")).rejects.toBeInstanceOf(NotYoursError);
  });
});

describe("recovery stays bounded", () => {
  it("records a capture PayPal made even after it forgot the request id, instead of capturing again", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    paypal.forgetRequestIds();
    advance(3);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments);
    expect(row).toMatchObject({ status: "captured", paypalCaptureId: "CAP-AUTH1" });
    expect(await reservation(row!.id)).toBe("captured");
    expect(paypal.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  it("stops sending a void PayPal keeps refusing after five tries", async () => {
    const { paypal, deps, advance } = setup();
    const { link } = await approved(deps);
    paypal.fail.void = { status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" };
    await decideApproval(deps, link.token, "reject");
    for (let i = 0; i < 10; i++) {
      advance(3);
      await sweepApprovals(deps);
    }
    expect(paypal.calls.filter((c) => c.op === "void")).toHaveLength(5);
  });

  it("retries a hold PayPal doesn't answer less and less often, and it goes through once PayPal is back", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    for (let i = 0; i < 10; i++) {
      advance(3);
      await sweepApprovals(deps);
    }
    // 30 minutes of outage: tried after 2, 4, 8 and 16 minute gaps, not on every sweep.
    expect(paypal.calls.filter((c) => c.op === "order").length).toBeLessThanOrEqual(1 + 4);
    delete paypal.fail.order;
    advance(6 * 60);
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
  });

  it("one agent's call doesn't resume other shoppers' stuck payments; the cron's sweep does", async () => {
    const { paypal, deps, advance } = setup();
    const theirs = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "network";
    await expect(requestPayment(deps, { mandateId: theirs.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    advance(3);
    const mine = await seedLinkedMandate(db, samplePolicy());
    const before = paypal.calls.length;
    await checkMandate(deps, mine.id);
    expect(paypal.calls.length).toBe(before);
    await sweepApprovals(deps);
    expect((await db.select().from(payments).where(eq(payments.mandateId, theirs.id)))[0]!.status).toBe("captured");
  });
});

describe("recovery stays bounded, whatever PayPal answers", () => {
  const UNAVAILABLE = { status: 503, name: "SERVICE_UNAVAILABLE", issue: "SERVICE_UNAVAILABLE" } as const;
  const sweeps = async (deps: ApprovalDeps, advance: (m: number) => unknown, n: number) => {
    for (let i = 0; i < n; i++) {
      advance(3);
      await sweepApprovals(deps);
    }
  };

  it("a PayPal 5xx on capture is no answer: the row stays capturing and a later sweep captures it", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = UNAVAILABLE;
    const first = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(first.payment.status).toBe("capturing");
    delete paypal.fail.capture;
    await sweeps(deps, advance, 2);
    const [row] = await db.select().from(payments);
    expect(row!.status).toBe("captured");
    const types = (await db.select().from(ledgerEvents).where(eq(ledgerEvents.paymentId, row!.id))).map((e) => e.type);
    expect(types).not.toContain("capture.failed");
  });

  it("a failed read of a capture PayPal already made is tried again, never turned into a decline or a second capture", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    paypal.forgetRequestIds();
    // Even a refusal (4xx) to show the order is "not known yet", never a decline of the capture.
    paypal.fail.readOrder = { status: 401, name: "AUTHENTICATION_FAILURE", issue: "AUTHENTICATION_FAILURE" };
    await sweeps(deps, advance, 2);
    expect((await db.select().from(payments))[0]!.status).toBe("capturing");
    delete paypal.fail.readOrder;
    await sweeps(deps, advance, 1);
    const [row] = await db.select().from(payments);
    expect(row).toMatchObject({ status: "captured", paypalCaptureId: "CAP-AUTH1" });
    expect(await reservation(row!.id)).toBe("captured");
    expect(paypal.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  it("a capture PayPal keeps declining and a void it keeps refusing both stop", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = DECLINED;
    paypal.fail.void = UNAVAILABLE;
    ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    await sweeps(deps, advance, 30);
    expect(paypal.calls.filter((c) => c.op === "capture").length).toBeLessThanOrEqual(MAX_CAPTURE_ATTEMPTS);
    expect(paypal.calls.filter((c) => c.op === "void").length).toBeLessThanOrEqual(5);
  });

  it("a capture PayPal doesn't answer is tried less and less often, and recorded once PayPal is back", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = UNAVAILABLE;
    ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    await sweeps(deps, advance, 30);
    expect(paypal.calls.filter((c) => c.op === "capture").length).toBeLessThanOrEqual(1 + 6);
    delete paypal.fail.capture;
    advance(6 * 60);
    await sweepApprovals(deps);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
  });

  it("rows past their limit don't crowd out the others", async () => {
    const { paypal, deps, advance } = setup();
    const capped = await seedLinkedMandate(db, samplePolicy());
    const { payment } = ok(await requestPayment(deps, { mandateId: capped.id, runId: "run-1", source: "agent", cart: bigCart() }));
    // A void that stopped part-way (status voiding) and that PayPal has already refused five times.
    await db.update(payments).set({ status: "voiding" }).where(eq(payments.id, payment.id));
    await db.insert(ledgerEvents).values(
      Array.from({ length: 5 }, () => ({ mandateId: capped.id, mandateHash: payment.mandateHash, paymentId: payment.id, type: "void.failed", createdAt: new Date("2026-11-03T15:00:00Z") })),
    );
    const other = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "network";
    await expect(requestPayment(deps, { mandateId: other.id, runId: "run-2", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.order;
    advance(3);
    await resumeStuckPayments(deps, { limit: 1 });
    expect((await db.select().from(payments).where(eq(payments.mandateId, other.id)))[0]!.status).toBe("captured");
    expect(paypal.calls.filter((c) => c.op === "void")).toHaveLength(0);
  });

  it("a capture PayPal answers 'already captured' is read back and recorded", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = "lost";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.capture;
    paypal.forgetRequestIds();
    const [row] = await db.select().from(payments);
    await db.update(payments).set({ status: "authorized" }).where(eq(payments.id, row!.id));
    expect(await capturePayment(deps, row!.id)).toMatchObject({ status: "captured", paypalCaptureId: "CAP-AUTH1" });
    expect(await reservation(row!.id)).toBe("captured");
  });

  it("a revoked hold PayPal won't release stops being tried and doesn't hold the front of the queue", async () => {
    const { paypal, deps, advance } = setup();
    const capped = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = DECLINED;
    ok(await requestPayment(deps, { mandateId: capped.id, runId: "run-1", source: "agent", cart: cart() }));
    delete paypal.fail.capture;
    paypal.fail.void = { status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" };
    await revokeMandate(deps, capped.id);
    await sweeps(deps, advance, 10);
    expect(paypal.calls.filter((c) => c.op === "void").length).toBeLessThanOrEqual(5);
    const other = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "network";
    await expect(requestPayment(deps, { mandateId: other.id, runId: "run-2", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    delete paypal.fail.order;
    advance(3);
    await resumeStuckPayments(deps, { limit: 1 });
    expect((await db.select().from(payments).where(eq(payments.mandateId, other.id)))[0]!.status).toBe("captured");
  });

  it("a revoke lists a payment PayPal hasn't confirmed as still open, once", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = UNAVAILABLE;
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(payment.status).toBe("capturing");
    expect((await revokeMandate(deps, mandate.id)).stillOpen).toEqual([payment.id]);
  });

  it("a mandate's own sweep only applies that mandate's answered or expired approvals", async () => {
    const { paypal, deps, advance } = setup();
    const a = await approved(deps);
    const b = await approved(deps);
    await decideApproval(deps, a.link.token, "reject").catch(() => {});
    paypal.fail.void = UNAVAILABLE;
    await decideApproval(deps, b.link.token, "reject");
    delete paypal.fail.void;
    advance(5);
    const before = paypal.calls.filter((c) => c.op === "void").length;
    await sweepApprovals(deps, { mandateId: a.mandate.id });
    expect(paypal.calls.filter((c) => c.op === "void").length).toBe(before);
    await sweepApprovals(deps, { mandateId: b.mandate.id });
    expect(paypal.calls.filter((c) => c.op === "void").length).toBe(before + 1);
  });
});

describe("an outage is ridden out, on every path", () => {
  const UNAVAILABLE = { status: 503, name: "SERVICE_UNAVAILABLE", issue: "SERVICE_UNAVAILABLE" } as const;
  const minuteSweeps = async (deps: ApprovalDeps, advance: (m: number) => unknown, minutes: number, lift?: () => void, liftAt = Infinity) => {
    for (let m = 1; m <= minutes; m++) {
      if (m === liftAt) lift?.();
      advance(1);
      await sweepApprovals(deps);
    }
  };

  it("a hold placed during a 15-minute outage goes through within about half an hour, by itself", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    await minuteSweeps(deps, advance, 35, () => delete paypal.fail.order, 15);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
    expect(new Set(paypal.calls.filter((c) => c.op === "order").map((c) => c.requestId)).size).toBe(1);
  });

  it("a release PayPal doesn't answer is retried, not given up, and the budget comes back", async () => {
    const { paypal, deps, advance } = setup();
    const { link, payment } = await approved(deps);
    paypal.fail.void = UNAVAILABLE;
    await decideApproval(deps, link.token, "reject");
    await minuteSweeps(deps, advance, 40, () => delete paypal.fail.void, 10);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("a hold PayPal expired by itself releases its budget on the next retry, without a webhook", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = UNAVAILABLE;
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "EXPIRED";
    advance(10);
    await sweepApprovals(deps);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("a hold PayPal refused to release five times still gives its budget back when PayPal expires it", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    paypal.fail.void = { status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" };
    await revokeMandate(deps, mandate.id);
    await minuteSweeps(deps, advance, 60);
    expect(paypal.calls.filter((c) => c.op === "void").length).toBeLessThanOrEqual(5);
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "EXPIRED";
    advance(7 * 60);
    await sweepApprovals(deps);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("an allowed hold PayPal refused to release five times gives its budget back when PayPal expires it", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = DECLINED;
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    delete paypal.fail.capture;
    paypal.fail.void = { status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" };
    await revokeMandate(deps, mandate.id);
    await minuteSweeps(deps, advance, 60);
    const voidsBefore = paypal.calls.filter((c) => c.op === "void").length;
    expect(voidsBefore).toBeLessThanOrEqual(5);
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "EXPIRED";
    advance(7 * 60);
    await sweepApprovals(deps);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
    expect(paypal.calls.filter((c) => c.op === "void").length).toBe(voidsBefore);
  });

  it("a rejected hold PayPal refused to release five times gives its budget back when PayPal expires it", async () => {
    const { paypal, deps, advance } = setup();
    const { link, payment } = await approved(deps);
    paypal.fail.void = { status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" };
    await decideApproval(deps, link.token, "reject");
    await minuteSweeps(deps, advance, 60);
    expect(paypal.calls.filter((c) => c.op === "void").length).toBe(5);
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "EXPIRED";
    advance(7 * 60);
    await sweepApprovals(deps);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("a void stuck part-way past the limit is still looked up, and released when PayPal expires the hold", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    await db.update(payments).set({ status: "voiding" }).where(eq(payments.id, payment.id));
    await db.insert(ledgerEvents).values(
      Array.from({ length: 5 }, () => ({ mandateId: mandate.id, mandateHash: payment.mandateHash, paymentId: payment.id, type: "void.failed", createdAt: new Date("2026-11-03T15:00:00Z") })),
    );
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "EXPIRED";
    advance(7 * 60);
    await resumeStuckPayments(deps);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
    expect(paypal.calls.filter((c) => c.op === "void")).toHaveLength(0);
  });

  it("a hold PayPal denied releases its budget", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.capture = UNAVAILABLE;
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    paypal.auths.get(payment.paypalAuthorizationId!)!.status = "DENIED";
    advance(10);
    await sweepApprovals(deps);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("a revoke during an outage releases a waiting hold once PayPal is back, not a day later", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    paypal.fail.void = UNAVAILABLE;
    await revokeMandate(deps, mandate.id);
    await minuteSweeps(deps, advance, 40, () => delete paypal.fail.void, 10);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("voided");
    expect(await reservation(payment.id)).toBe("released");
  });

  it("never releases a hold the user still has to answer, whatever its history", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { payment } = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    await db.insert(ledgerEvents).values({ mandateId: mandate.id, mandateHash: payment.mandateHash, paymentId: payment.id, type: "void.failed", createdAt: new Date("2026-11-03T15:00:00Z") });
    await minuteSweeps(deps, advance, 60);
    expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("pending_approval");
    expect(paypal.calls.filter((c) => c.op === "void")).toHaveLength(0);
  });

  it("a void Chaperone can't send (no credentials for the shop) counts as refused, not as an outage", async () => {
    const { paypal, deps } = setup();
    const { link, payment } = await approved(deps);
    const noShopApp: ApprovalDeps = { ...deps, payees: { ...deps.payees, forPayee: () => { throw new UnknownPayeeError("no credentials"); } } as typeof deps.payees };
    await decideApproval(noShopApp, link.token, "reject");
    const types = (await db.select().from(ledgerEvents).where(eq(ledgerEvents.paymentId, payment.id))).map((e) => e.type);
    expect(types).toContain("void.failed");
    expect(types).not.toContain("void.unanswered");
    void paypal;
  });

  it("a row with a very long history of unanswered tries can't break the retry queue", async () => {
    const { paypal, deps, advance } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = "network";
    await expect(requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() })).rejects.toThrow("fetch failed");
    const [row] = await db.select().from(payments);
    await db.insert(ledgerEvents).values(
      Array.from({ length: 1100 }, () => ({ mandateId: mandate.id, mandateHash: row!.mandateHash, paymentId: row!.id, type: "resume.failed", createdAt: new Date("2026-11-03T15:00:00Z") })),
    );
    advance(10);
    await expect(resumeStuckPayments(deps)).resolves.toBeDefined();
  });
});
