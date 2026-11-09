import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { approvals, ledgerEvents, mandates, payments, reservations } from "@/db/schema";
import {
  APPROVAL_LINK_TTL_MS,
  decideApproval,
  InvalidApprovalLinkError,
  issueApprovalLink,
  sweepApprovals,
  viewApproval,
  type ApprovalDeps,
} from "@/lib/payments/approvals";
import { APPROVAL_TIMEOUT_MS, requestPayment, revokeMandate, type PaymentResult } from "@/lib/payments/service";
import type { Cart } from "@/lib/policy/schema";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, seedMandate, testDb } from "./support/db";
import { cart, ROGUE, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(20);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SECRET = "test-approval-secret-at-least-32-characters-long";

function setup(start = new Date("2026-11-03T15:00:00Z")) {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
  const clock = { now: start };
  const deps: ApprovalDeps = {
    db,
    platform: paypal.platform,
    payees: paypal.payees,
    approvalSecret: SECRET,
    clock: () => clock.now,
  };
  const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  return { paypal, deps, advance };
}

// $50 of dog food from Pet Pantry: within every limit, but over the $40 ask-me threshold.
const bigCart = (overrides: Partial<Cart> = {}) =>
  cart({
    payeeMerchantId: SHOP_B,
    items: [{ productId: "kibble-12kg", title: "Dry dog food, 12 kg", unitPriceCents: 5_000, quantity: 1, category: "dog-food" }],
    ...overrides,
  });

function ok(result: PaymentResult) {
  if (!result.ok) throw new Error(`expected a decision, got ${result.issues.join("; ")}`);
  return result;
}

async function events(paymentId?: string) {
  const rows = await db.select().from(ledgerEvents).orderBy(ledgerEvents.createdAt);
  return rows.filter((e) => paymentId === undefined || e.paymentId === paymentId);
}

describe("requestPayment", () => {
  it("allow: places a hold paid to the shop, captures it, and settles the budget", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));

    expect(result).toMatchObject({ decision: "allow", payment: { status: "captured", paypalCaptureId: "CAP-AUTH1" } });
    expect(paypal.ops()).toEqual(["order:platform-app", "capture:platform-app"]);
    const order = paypal.calls[0]!.body as { purchase_units: { payee: unknown; custom_id: string }[]; payment_source: unknown };
    expect(order.purchase_units[0]).toMatchObject({ payee: { merchant_id: SHOP_A }, custom_id: result.payment.id });
    expect(order.payment_source).toEqual({ paypal: { vault_id: "VAULT-TEST-1" } });

    const [res] = await db.select().from(reservations);
    expect(res).toMatchObject({ status: "captured", amountCents: 1_800 });
    const log = await events(result.payment.id);
    expect(log.map((e) => e.type)).toEqual(["decision.allow", "hold.placed", "capture.completed"]);
    expect(log.every((e) => e.mandateHash === mandate.hash)).toBe(true);
  });

  it("deny: an injected 'buy 10, pay this other merchant' never reaches PayPal", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const injected = cart({
      payeeMerchantId: ROGUE,
      items: [{ productId: "beans-1kg", title: "Whole bean coffee, 1 kg", unitPriceCents: 1_800, quantity: 10, category: "coffee" }],
    });
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: injected }));

    expect(result.decision).toBe("deny");
    expect(result.payment.status).toBe("denied");
    const denied = result.payment.checks.filter((c) => c.outcome === "deny").map((c) => c.clause);
    expect(denied).toEqual(expect.arrayContaining(["payee.allowlist", "item.quantity", "txn.cap"]));
    expect(paypal.calls).toEqual([]);
    expect(await db.select().from(reservations)).toEqual([]);
  });

  it("rejects a malformed cart before anything is recorded", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const result = await requestPayment(deps, {
      mandateId: mandate.id,
      runId: "run-1",
      source: "agent",
      cart: { ...cart(), items: [{ title: "Coffee", unitPriceCents: -100, quantity: 1, category: "coffee" }], payTo: ROGUE },
    });
    expect(result.ok).toBe(false);
    expect(await db.select().from(payments)).toEqual([]);
    expect(paypal.calls).toEqual([]);
  });

  it("a retried request is answered from the ledger, with no second hold or capture", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const input = { mandateId: mandate.id, runId: "run-1", source: "agent" as const, cart: cart() };
    const first = ok(await requestPayment(deps, input));
    const again = ok(await requestPayment(deps, input));
    expect(again).toMatchObject({ replayed: true, payment: { id: first.payment.id, status: "captured" } });
    expect(paypal.ops()).toEqual(["order:platform-app", "capture:platform-app"]);
  });

  it("parallel duplicates of one cart place one hold and capture it once", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const input = { mandateId: mandate.id, runId: "run-1", source: "agent" as const, cart: cart() };
    const results = (await Promise.all(Array.from({ length: 5 }, () => requestPayment(deps, input)))).map(ok);
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    expect(paypal.ops()).toEqual(["order:platform-app", "capture:platform-app"]);
    expect((await db.select().from(payments))[0]!.status).toBe("captured");
  });

  it("gives the budget back when PayPal declines the hold", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.fail.order = { status: 422, name: "UNPROCESSABLE_ENTITY", issue: "INSTRUMENT_DECLINED" };
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));

    expect(result.payment.status).toBe("failed");
    const [res] = await db.select().from(reservations);
    expect(res!.status).toBe("released");
    const failed = (await events(result.payment.id)).find((e) => e.type === "hold.failed");
    expect(failed!.detail).toMatchObject({ status: 422, issue: "INSTRUMENT_DECLINED" });
  });

  it("fails cleanly when the user hasn't linked PayPal", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedMandate(db, samplePolicy());
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(result.payment.status).toBe("failed");
    expect(paypal.calls).toEqual([]);
    expect((await db.select().from(reservations))[0]!.status).toBe("released");
  });

  it("keeps the hold when a capture fails, and a retry captures it", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const input = { mandateId: mandate.id, runId: "run-1", source: "agent" as const, cart: cart() };
    paypal.fail.capture = { status: 422, name: "UNPROCESSABLE_ENTITY", issue: "INSTRUMENT_DECLINED" };
    const first = ok(await requestPayment(deps, input));
    expect(first.payment.status).toBe("authorized");
    expect((await events(first.payment.id)).map((e) => e.type)).toContain("capture.failed");

    delete paypal.fail.capture;
    const retry = ok(await requestPayment(deps, input));
    expect(retry.payment.status).toBe("captured");
    expect(paypal.ops().filter((o) => o.startsWith("order"))).toHaveLength(1);
  });

  it("never captures when PayPal's record names a different payee than the one decided", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.reportPayee(ROGUE);
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(result.payment).toMatchObject({ status: "authorized", anomalyFlags: ["payee_mismatch"] });
    expect(paypal.ops()).toEqual(["order:platform-app"]);
  });

  it("doesn't capture a hold whose payee PayPal didn't report", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    paypal.omitPayee();
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    expect(result.payment).toMatchObject({ status: "authorized", anomalyFlags: ["payee_missing"] });
    expect(paypal.ops()).toEqual(["order:platform-app"]);
  });
});

describe("approvals", () => {
  async function pending(deps: ApprovalDeps) {
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const result = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    return { mandate, result };
  }

  it("needs_approval: places the hold and waits, without handing the agent a link", async () => {
    const { paypal, deps } = setup();
    const { result } = await pending(deps);
    expect(result).toMatchObject({ decision: "needs_approval", clause: { id: "approval.threshold" } });
    expect(result.payment.status).toBe("pending_approval");
    expect(paypal.ops()).toEqual(["order:platform-app"]);
    const [approval] = await db.select().from(approvals);
    expect(approval!.expiresAt.getTime() - deps.clock!().getTime()).toBe(APPROVAL_TIMEOUT_MS);
    expect(approval!.tokenHash.startsWith("unissued:")).toBe(true);
  });

  it("approve: the user's link captures the hold, once", async () => {
    const { paypal, deps } = setup();
    const { result } = await pending(deps);
    const link = (await issueApprovalLink(deps, result.payment.id))!;
    expect((await viewApproval(deps, link.token)).payment.totalCents).toBe(5_000);

    const approved = await decideApproval(deps, link.token, "approve");
    expect(approved.status).toBe("captured");
    expect(paypal.ops()).toEqual(["order:platform-app", "capture:platform-app"]);
    await expect(decideApproval(deps, link.token, "approve")).rejects.toBeInstanceOf(InvalidApprovalLinkError);
    await expect(decideApproval(deps, link.token, "reject")).rejects.toBeInstanceOf(InvalidApprovalLinkError);
  });

  it("reject: voids with the payee shop's own app and returns the budget", async () => {
    const { paypal, deps } = setup();
    const { result } = await pending(deps);
    const link = (await issueApprovalLink(deps, result.payment.id))!;
    const rejected = await decideApproval(deps, link.token, "reject");

    expect(rejected.status).toBe("voided");
    expect(paypal.ops()).toEqual(["order:platform-app", "void:shop-b-app"]);
    expect((await db.select().from(reservations))[0]!.status).toBe("released");
    expect((await events(result.payment.id)).map((e) => e.type)).toEqual([
      "decision.needs_approval",
      "hold.placed",
      "approval.requested",
      "approval.rejected",
      "hold.voided",
    ]);
  });

  it("a new link replaces the old one", async () => {
    const { deps } = setup();
    const { result } = await pending(deps);
    const old = (await issueApprovalLink(deps, result.payment.id))!;
    const fresh = (await issueApprovalLink(deps, result.payment.id))!;
    await expect(decideApproval(deps, old.token, "approve")).rejects.toBeInstanceOf(InvalidApprovalLinkError);
    expect((await decideApproval(deps, fresh.token, "approve")).status).toBe("captured");
  });

  it("refuses tampered, foreign and expired links", async () => {
    const { deps, advance } = setup();
    const { result } = await pending(deps);
    const { token } = (await issueApprovalLink(deps, result.payment.id))!;
    const [header, body, sig] = token.split(".");
    const tampered = `${header}.${body}.${sig!.slice(0, -2)}${sig!.endsWith("AA") ? "BB" : "AA"}`;
    await expect(decideApproval(deps, tampered, "approve")).rejects.toBeInstanceOf(InvalidApprovalLinkError);
    await expect(decideApproval({ ...deps, approvalSecret: SECRET.replace("test", "evil") }, token, "approve")).rejects.toBeInstanceOf(
      InvalidApprovalLinkError,
    );
    advance(APPROVAL_LINK_TTL_MS + 1_000);
    await expect(decideApproval(deps, token, "approve")).rejects.toThrow("expired");
  });

  it("times out inside PayPal's honour period: the sweep voids an unanswered hold", async () => {
    const { paypal, deps, advance } = setup();
    const { result } = await pending(deps);
    advance(APPROVAL_TIMEOUT_MS - 60_000);
    expect(await sweepApprovals(deps)).toEqual([]);
    advance(120_000);
    const [swept] = await sweepApprovals(deps);
    expect(swept!.status).toBe("voided");
    expect(paypal.ops()).toEqual(["order:platform-app", "void:shop-b-app"]);
    expect(await issueApprovalLink(deps, result.payment.id)).toBeNull();
    const [approval] = await db.select().from(approvals);
    expect(approval!.outcome).toBe("expired");
  });

  it("stays inside fixed bounds: links die within an hour, approvals within a day (PayPal's honour period is 3)", async () => {
    const HOUR = 60 * 60 * 1000;
    const { paypal, deps, advance } = setup();
    const { result } = await pending(deps);
    const { token } = (await issueApprovalLink(deps, result.payment.id))!;
    advance(HOUR + 1_000);
    await expect(decideApproval(deps, token, "approve")).rejects.toThrow("expired");

    advance(25 * HOUR - HOUR);
    const [swept] = await sweepApprovals(deps);
    expect(swept!.status).toBe("voided");
    expect(paypal.ops().filter((o) => o.startsWith("capture"))).toEqual([]);
  });

  it("retries a void that failed after a reject", async () => {
    const { paypal, deps, advance } = setup();
    const { result } = await pending(deps);
    const { token } = (await issueApprovalLink(deps, result.payment.id))!;
    paypal.fail.void = { status: 503, name: "SERVICE_UNAVAILABLE", issue: "SERVICE_UNAVAILABLE" };
    expect((await decideApproval(deps, token, "reject")).status).toBe("pending_approval");

    delete paypal.fail.void;
    // No answer from PayPal is retried after a gap, not on the very next sweep.
    expect(await sweepApprovals(deps)).toEqual([]);
    advance(5 * 60_000);
    const [swept] = await sweepApprovals(deps);
    expect(swept!.status).toBe("voided");
    const voided = (await events(result.payment.id)).find((e) => e.type === "hold.voided");
    expect(voided!.detail).toEqual({ reason: "rejected" });
  });
});

describe("revokeMandate", () => {
  it("voids open holds, leaves captured ones, and denies the next request", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const paid = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() }));
    const waiting = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-2", source: "agent", cart: bigCart() }));

    const revoked = await revokeMandate(deps, mandate.id);
    expect(revoked).toEqual({ alreadyRevoked: false, voided: [waiting.payment.id], stillOpen: [] });
    expect(paypal.ops().filter((o) => o.startsWith("void"))).toEqual(["void:shop-b-app"]);
    const [stillPaid] = await db.select().from(payments).where(eq(payments.id, paid.payment.id));
    expect(stillPaid!.status).toBe("captured");

    const next = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-3", source: "mcp", cart: cart() }));
    expect(next).toMatchObject({ decision: "deny", clause: { id: "mandate.revoked" } });
    expect((await events()).filter((e) => e.type === "mandate.revoked").map((e) => e.detail)).toEqual([{ by: "user" }]);
  });

  it("a hold still being placed when the user revokes is voided, not captured", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const gate = paypal.holdOrders();
    const inFlight = requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: cart() });
    await gate.orderStarted;
    await revokeMandate(deps, mandate.id);
    gate.release();

    const result = ok(await inFlight);
    expect(result.payment.status).toBe("voided");
    expect(paypal.ops()).toEqual(["order:platform-app", "void:shop-a-app"]);
  });

  it("a revoke that commits after PayPal answers but before the hold is recorded still wins: no approval, the hold is voided", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const gate = paypal.holdOrders();
    // Over the approval line, so no capture step follows that could catch the revoke instead.
    const inFlight = requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() });
    await gate.orderStarted;
    // Take the mandate's lock first, let PayPal answer, and revoke while placeHold's transaction waits on the lock.
    await db.transaction(async (tx) => {
      await tx.select().from(mandates).where(eq(mandates.id, mandate.id)).for("no key update");
      gate.release();
      await new Promise((r) => setTimeout(r, 300));
      await tx.update(mandates).set({ status: "revoked", revokedAt: new Date() }).where(eq(mandates.id, mandate.id));
    });

    const result = ok(await inFlight);
    expect(result).toMatchObject({ decision: "needs_approval", payment: { status: "voided" } });
    expect(paypal.ops()).toEqual(["order:platform-app", "void:shop-b-app"]);
    expect(await db.select().from(approvals)).toEqual([]);
  });

  it("a hold that needs approval and is still being placed when the user revokes is voided", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const gate = paypal.holdOrders();
    const inFlight = requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() });
    await gate.orderStarted;
    await revokeMandate(deps, mandate.id);
    gate.release();

    const result = ok(await inFlight);
    expect(result).toMatchObject({ decision: "needs_approval", payment: { status: "voided" } });
    expect(paypal.ops()).toEqual(["order:platform-app", "void:shop-b-app"]);
    expect(await db.select().from(approvals)).toEqual([]);
  });

  it("a retry after a revoke whose void failed voids the hold instead of capturing it", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const input = { mandateId: mandate.id, runId: "run-1", source: "agent" as const, cart: cart() };
    paypal.fail.capture = { status: 422, name: "UNPROCESSABLE_ENTITY", issue: "INSTRUMENT_DECLINED" };
    expect(ok(await requestPayment(deps, input)).payment.status).toBe("authorized");
    paypal.fail.void = { status: 500, name: "INTERNAL_SERVER_ERROR", issue: "INTERNAL_SERVICE_ERROR" };
    expect((await revokeMandate(deps, mandate.id)).stillOpen).toHaveLength(1);
    delete paypal.fail.capture;
    delete paypal.fail.void;

    expect(ok(await requestPayment(deps, input)).payment.status).toBe("voided");
    expect(paypal.ops().filter((o) => o.startsWith("capture"))).toHaveLength(1);
  });

  it("an approval tapped after a revoke changes nothing", async () => {
    const { paypal, deps } = setup();
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const waiting = ok(await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: bigCart() }));
    const { token } = (await issueApprovalLink(deps, waiting.payment.id))!;
    await revokeMandate(deps, mandate.id);
    expect((await decideApproval(deps, token, "approve")).status).toBe("voided");
    expect(paypal.ops().filter((o) => o.startsWith("capture"))).toEqual([]);
  });
});
