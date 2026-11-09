import { and, count, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { approvals, ledgerEvents, mandates, paymentMethods, payments } from "@/db/schema";
import { paypalRequestId } from "@/lib/ledger/idempotency";
import { decideAndReserve, releaseReservation, settleReservation, type Payment } from "@/lib/ledger/reserve";
import { PayPalError, type PayPalClient } from "@/lib/paypal/client";
import { money, toCents } from "@/lib/paypal/money";
import { createAuthorizeOrder, firstAuthorization, getOrder } from "@/lib/paypal/orders";
import { voidHold, type PayeeClients } from "@/lib/paypal/payees";
import { captureAuthorization, getAuthorization, type Capture } from "@/lib/paypal/payments";
import type { Evaluation } from "@/lib/policy/evaluate";
import { cartSchema } from "@/lib/policy/schema";

export type PaymentDeps = {
  db: Db;
  /** Chaperone's own app: places holds with the vaulted wallet and captures them. */
  platform: PayPalClient;
  /** Each shop's app: PayPal only lets the payee void a hold (D9). */
  payees: PayeeClients;
  clock?: () => Date;
};

export type PaymentRequest = {
  mandateId: string;
  runId: string | null;
  source: "agent" | "mcp";
  /** Untrusted: whatever the agent proposed. Validated field by field here. */
  cart: unknown;
};

export type PaymentResult =
  | { ok: false; reason: "invalid_cart"; issues: string[] }
  | {
      ok: true;
      payment: Payment;
      decision: Evaluation["decision"];
      clause: { id: string; text: string };
      replayed: boolean;
    };

// Inside PayPal's 3-day honour period (F3), so an approved purchase is captured on the original hold.
export const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// A row still authorizing after this long was most likely interrupted; a retry may resume it, and
// PayPal's request-id dedupe returns the same order instead of creating a second one.
const STALE_AUTHORIZING_MS = 2 * 60 * 1000;

// A capture or void claimed this long ago and never finished was interrupted (a crash, a network error after the
// claim); the sweep resumes it with the same PayPal-Request-Id, so PayPal can't act twice.
const STALE_CLAIM_MS = 2 * 60 * 1000;

// After this many declined captures the hold is released, so its budget isn't locked until PayPal expires it.
export const MAX_CAPTURE_ATTEMPTS = 3;
export const MAX_RESUME_ATTEMPTS = 5;
export const MAX_VOID_ATTEMPTS = 5;

const OPEN_HOLD = ["authorized", "pending_approval"] as const;

function nowOf(deps: PaymentDeps): Date {
  return deps.clock?.() ?? new Date();
}

async function logEvent(
  tx: Db | Tx,
  payment: Payment,
  type: string,
  now: Date,
  extra: { amountCents?: number; paypalResourceId?: string; detail?: Record<string, unknown> } = {},
) {
  await tx.insert(ledgerEvents).values({
    mandateId: payment.mandateId,
    mandateHash: payment.mandateHash,
    paymentId: payment.id,
    type,
    amountCents: extra.amountCents ?? null,
    paypalResourceId: extra.paypalResourceId ?? null,
    detail: extra.detail ?? null,
    createdAt: now,
  });
}

function paypalDetail(error: unknown): Record<string, unknown> {
  if (error instanceof PayPalError) {
    return { status: error.status, name: error.body.name, issue: error.issue, debugId: error.debugId };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

async function getPayment(db: Db | Tx, id: string): Promise<Payment> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, id));
  if (!payment) throw new Error(`payment ${id} not found`);
  return payment;
}

/**
 * The single path from an agent's cart to money moving. The evaluator decides; this only carries
 * the decision out: deny → nothing at PayPal; allow → hold then capture; needs_approval → hold and
 * wait for the user. Budget is reserved before PayPal is called and released if the hold doesn't stick.
 */
export async function requestPayment(deps: PaymentDeps, request: PaymentRequest): Promise<PaymentResult> {
  const parsed = cartSchema.safeParse(request.cart);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_cart",
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "cart"}: ${i.message}`),
    };
  }

  const now = nowOf(deps);
  const decided = await decideAndReserve(deps.db, {
    mandateId: request.mandateId,
    runId: request.runId,
    source: request.source,
    cart: parsed.data,
    now,
  });
  let payment = decided.payment;

  if (payment.status === "authorizing") {
    const stale = now.getTime() - payment.updatedAt.getTime() > STALE_AUTHORIZING_MS;
    if (!decided.replayed || stale) payment = await placeHold(deps, payment);
  } else if (decided.replayed && capturable(payment)) {
    payment = await capturePayment(deps, payment.id);
  }

  return {
    ok: true,
    payment,
    decision: decided.evaluation.decision,
    clause: { id: decided.evaluation.clause.id, text: decided.evaluation.clause.text },
    replayed: decided.replayed,
  };
}

/** An allowed hold with nothing suspicious about it; anomalies are left for a human to look at. */
function capturable(payment: Payment): boolean {
  return payment.status === "authorized" && payment.decision === "allow" && payment.anomalyFlags.length === 0;
}

async function failAuthorizing(deps: PaymentDeps, payment: Payment, type: string, detail: Record<string, unknown>) {
  const now = nowOf(deps);
  return deps.db.transaction(async (tx) => {
    const [failed] = await tx
      .update(payments)
      .set({ status: "failed", updatedAt: now })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "authorizing")))
      .returning();
    if (!failed) return getPayment(tx, payment.id);
    await releaseReservation(tx, payment.id, now);
    await logEvent(tx, failed, type, now, { amountCents: failed.totalCents, detail });
    return failed;
  });
}

async function placeHold(deps: PaymentDeps, payment: Payment): Promise<Payment> {
  const [method] = await deps.db
    .select({ vaultId: paymentMethods.paypalPaymentTokenId })
    .from(paymentMethods)
    .innerJoin(mandates, eq(mandates.userId, paymentMethods.userId))
    .where(and(eq(mandates.id, payment.mandateId), eq(paymentMethods.status, "active")))
    .orderBy(desc(paymentMethods.createdAt))
    .limit(1);
  if (!method) return failAuthorizing(deps, payment, "hold.failed", { reason: "no_linked_paypal" });

  let order;
  try {
    order = await createAuthorizeOrder(deps.platform, {
      vaultId: method.vaultId,
      payeeMerchantId: payment.payeeMerchantId,
      currency: payment.currency,
      items: payment.items,
      shippingCents: payment.shippingCents,
      taxCents: payment.taxCents,
      paymentId: payment.id,
      requestId: paypalRequestId(payment.idempotencyKey, "order"),
    });
  } catch (error) {
    // Only a definite PayPal refusal (4xx) means no hold exists. A network failure or a PayPal 5xx may have placed
    // one, so the row stays authorizing and is resumed with the same request id; marking it failed would let the
    // same cart be bought again (D28) under a new id, leaving the first hold orphaned.
    if (error instanceof PayPalError && error.status < 500) return failAuthorizing(deps, payment, "hold.failed", paypalDetail(error));
    throw error;
  }

  const auth = firstAuthorization(order);
  if (!auth || auth.status !== "CREATED") {
    return failAuthorizing(deps, payment, "hold.failed", {
      orderId: order.id,
      orderStatus: order.status,
      authorizationStatus: auth?.status ?? null,
    });
  }

  // PayPal's own record is the truth about who is paid and how much; it must match what was decided.
  const anomalies: string[] = [];
  const payee = order.purchase_units[0]?.payee?.merchant_id;
  // Every response is requested with return=representation, and live sandbox orders carry the payee (P6.8), so a
  // missing one is as suspect as a wrong one.
  if (payee !== payment.payeeMerchantId) anomalies.push(payee === undefined ? "payee_missing" : "payee_mismatch");
  if (toCents(auth.amount) !== payment.totalCents) anomalies.push("amount_mismatch");

  const now = nowOf(deps);
  const { held, revoked } = await deps.db.transaction(async (tx) => {
    // Locking the mandate orders this against a concurrent revoke: whichever commits second sees the other.
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, payment.mandateId)).for("no key update");
    const waitForUser = payment.decision === "needs_approval" && mandate!.status === "active";
    const [held] = await tx
      .update(payments)
      .set({
        status: waitForUser ? "pending_approval" : "authorized",
        paypalOrderId: order.id,
        paypalAuthorizationId: auth.id,
        anomalyFlags: anomalies,
        updatedAt: now,
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "authorizing")))
      .returning();
    if (!held) return { held: await getPayment(tx, payment.id), revoked: false };

    await logEvent(tx, held, "hold.placed", now, {
      amountCents: toCents(auth.amount),
      paypalResourceId: auth.id,
      detail: { orderId: order.id, expiresAt: auth.expiration_time ?? null },
    });
    if (anomalies.length) {
      await logEvent(tx, held, "anomaly", now, { paypalResourceId: auth.id, detail: { flags: anomalies, payee } });
    }
    if (waitForUser) {
      // No usable link yet: the hash matches no token. A link is issued only to the user, never to the agent.
      await tx
        .insert(approvals)
        .values({
          paymentId: held.id,
          tokenHash: `unissued:${held.id}`,
          expiresAt: new Date(now.getTime() + APPROVAL_TIMEOUT_MS),
          createdAt: now,
        })
        .onConflictDoNothing();
      await logEvent(tx, held, "approval.requested", now, { amountCents: held.totalCents });
    }
    return { held, revoked: mandate!.status === "revoked" };
  });

  if (revoked) return voidPayment(deps, held.id, "mandate_revoked");
  if (capturable(held)) return capturePayment(deps, held.id);
  return held;
}

export class CaptureNotAllowedError extends Error {}

/**
 * Captures a hold. Allowed only for an allowed payment, or a needs_approval payment the user approved,
 * with no anomaly flags, on a mandate that is still active.
 */
/**
 * `resume` picks up a capture interrupted after its claim. `captured` says PayPal already reports the authorization as
 * captured: the money has moved, so the capture is recorded even if the mandate was revoked since.
 */
export async function capturePayment(deps: PaymentDeps, paymentId: string, options: { resume?: boolean; captured?: boolean } = {}): Promise<Payment> {
  const now = nowOf(deps);
  const claim = await deps.db.transaction(async (tx) => {
    const current = await getPayment(tx, paymentId);
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, current.mandateId)).for("no key update");
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("no key update");
    const interrupted = options.resume && payment!.status === "capturing" && now.getTime() - payment!.updatedAt.getTime() > STALE_CLAIM_MS;
    if (payment!.status !== "authorized" && !interrupted) return { kind: "skip" as const, payment: payment! };
    if (mandate!.status === "revoked" && !options.captured) {
      if (interrupted) await tx.update(payments).set({ status: "authorized", updatedAt: now }).where(eq(payments.id, paymentId));
      return { kind: "revoked" as const, payment: payment! };
    }
    if (payment!.anomalyFlags.length && !options.captured) throw new CaptureNotAllowedError(`payment ${paymentId} has anomalies`);
    if (!options.captured) {
      // Declined too often already: no more capture requests; the hold is released instead.
      const [declined] = await tx
        .select({ n: count() })
        .from(ledgerEvents)
        .where(and(eq(ledgerEvents.paymentId, paymentId), eq(ledgerEvents.type, "capture.failed")));
      if ((declined?.n ?? 0) >= MAX_CAPTURE_ATTEMPTS) return { kind: "exhausted" as const, payment: payment! };
    }
    if (payment!.decision === "needs_approval") {
      const [approval] = await tx.select().from(approvals).where(eq(approvals.paymentId, paymentId));
      if (approval?.outcome !== "approved") throw new CaptureNotAllowedError(`payment ${paymentId} is not approved`);
    } else if (payment!.decision !== "allow") {
      throw new CaptureNotAllowedError(`payment ${paymentId} was denied`);
    }
    const [claimed] = await tx
      .update(payments)
      .set({ status: "capturing", updatedAt: now })
      .where(eq(payments.id, paymentId))
      .returning();
    return { kind: "claimed" as const, payment: claimed! };
  });

  if (claim.kind === "skip") return claim.payment;
  if (claim.kind === "revoked") return voidPayment(deps, paymentId, "mandate_revoked");
  if (claim.kind === "exhausted") return voidPayment(deps, paymentId, "capture_failed");
  const payment = claim.payment;

  let capture;
  try {
    // PayPal already captured it (the answer was lost): record that capture. Sending another, even with the same
    // request id, fails once PayPal no longer remembers the id, and the payment would stay unpaid in the ledger.
    if (options.captured) capture = await existingCapture(deps, payment);
    else {
      try {
        capture = await captureAuthorization(deps.platform, payment.paypalAuthorizationId!, {
          requestId: paypalRequestId(payment.idempotencyKey, "capture"),
        });
      } catch (error) {
        if (!(error instanceof PayPalError && error.issue === "AUTHORIZATION_ALREADY_CAPTURED")) throw error;
        capture = await existingCapture(deps, payment);
      }
    }
  } catch (error) {
    // Only a definite refusal (4xx) counts as a decline. No answer, a timeout or a PayPal 5xx leaves the row
    // capturing; the sweep resumes it and asks PayPal first whether it captured (resumeStuckPayments).
    if (!(error instanceof PayPalError) || error.status >= 500) {
      if (error instanceof PayPalError) {
        await logEvent(deps.db, payment, "capture.unanswered", nowOf(deps), { detail: paypalDetail(error) });
        return getPayment(deps.db, paymentId);
      }
      throw error;
    }
    const { back, failures } = await deps.db.transaction(async (tx) => {
      const [back] = await tx
        .update(payments)
        .set({ status: "authorized", updatedAt: nowOf(deps) })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "capturing")))
        .returning();
      await logEvent(tx, payment, "capture.failed", nowOf(deps), { detail: paypalDetail(error) });
      const [row] = await tx
        .select({ n: count() })
        .from(ledgerEvents)
        .where(and(eq(ledgerEvents.paymentId, paymentId), eq(ledgerEvents.type, "capture.failed")));
      return { back: back ?? (await getPayment(tx, paymentId)), failures: row?.n ?? 0 };
    });
    if (back.status === "authorized" && failures >= MAX_CAPTURE_ATTEMPTS) return voidPayment(deps, paymentId, "capture_failed");
    return back;
  }

  return deps.db.transaction(async (tx) => {
    const done = nowOf(deps);
    const [captured] = await tx
      .update(payments)
      .set({ status: "captured", paypalCaptureId: capture.id, updatedAt: done })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "capturing")))
      .returning();
    if (!captured) return getPayment(tx, paymentId);
    await settleReservation(tx, paymentId, done);
    await logEvent(tx, captured, "capture.completed", done, {
      amountCents: toCents(capture.amount),
      paypalResourceId: capture.id,
      detail: { status: capture.status },
    });
    return captured;
  });
}

/** The capture PayPal already made for this hold, read from the order. Throws if PayPal can't show it yet. */
async function existingCapture(deps: PaymentDeps, payment: Payment): Promise<Capture> {
  if (!payment.paypalOrderId) throw new Error(`payment ${payment.id} has no PayPal order to read the capture from`);
  // Whatever goes wrong reading it is "not yet known", never a decline of the capture.
  const order = await getOrder(deps.platform, payment.paypalOrderId).catch((error) => {
    throw new Error(`reading PayPal order ${payment.paypalOrderId} failed: ${error instanceof Error ? error.message : error}`);
  });
  const found = order.purchase_units[0]?.payments?.captures?.find((c) => c.status !== "DECLINED" && c.status !== "FAILED");
  // Not a PayPalError, so it never counts as a decline: the row stays capturing and is asked again next sweep.
  if (!found) throw new Error(`PayPal reports payment ${payment.id} captured, but its order shows no capture yet`);
  return { id: found.id, status: found.status, amount: found.amount ?? money(payment.totalCents, payment.currency) };
}

export type VoidReason = "rejected" | "approval_expired" | "mandate_revoked" | "capture_failed" | "resumed";

/** Releases an open hold with the payee shop's credentials and gives the budget back. */
export async function voidPayment(deps: PaymentDeps, paymentId: string, reason: VoidReason, options: { resume?: boolean } = {}): Promise<Payment> {
  const now = nowOf(deps);
  const claim = await deps.db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("no key update");
    const interrupted = options.resume && payment?.status === "voiding" && now.getTime() - payment.updatedAt.getTime() > STALE_CLAIM_MS;
    if (!payment || (!(OPEN_HOLD as readonly string[]).includes(payment.status) && !interrupted)) return null;
    // A void PayPal keeps refusing isn't sent forever (sweeps and revokes would retry it every time); the ledger shows
    // each failure, and PayPal releases the hold itself when the authorization expires.
    const [failed] = await tx
      .select({ n: count() })
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.paymentId, paymentId), eq(ledgerEvents.type, "void.failed")));
    if ((failed?.n ?? 0) >= MAX_VOID_ATTEMPTS) return null;
    const [claimed] = await tx
      .update(payments)
      .set({ status: "voiding", updatedAt: now })
      .where(eq(payments.id, paymentId))
      .returning();
    // An interrupted void stays claimed on failure, for the next sweep to try again.
    return { payment: claimed!, previous: payment.status as (typeof OPEN_HOLD)[number] | "voiding" };
  });
  if (!claim) return getPayment(deps.db, paymentId);
  const { payment, previous } = claim;

  try {
    await voidHold({
      platform: deps.platform,
      payees: deps.payees,
      authorizationId: payment.paypalAuthorizationId!,
      expectedPayeeMerchantId: payment.payeeMerchantId,
      requestId: paypalRequestId(payment.idempotencyKey, "void"),
    });
  } catch (error) {
    return deps.db.transaction(async (tx) => {
      const [back] = await tx
        .update(payments)
        .set({ status: previous, updatedAt: nowOf(deps) })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "voiding")))
        .returning();
      await logEvent(tx, payment, "void.failed", nowOf(deps), { detail: { reason, ...paypalDetail(error) } });
      return back ?? getPayment(tx, paymentId);
    });
  }

  return deps.db.transaction(async (tx) => {
    const done = nowOf(deps);
    const [voided] = await tx
      .update(payments)
      .set({ status: "voided", updatedAt: done })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "voiding")))
      .returning();
    if (!voided) return getPayment(tx, paymentId);
    await releaseReservation(tx, paymentId, done);
    await logEvent(tx, voided, "hold.voided", done, {
      amountCents: voided.totalCents,
      paypalResourceId: voided.paypalAuthorizationId ?? undefined,
      detail: { reason },
    });
    return voided;
  });
}

/**
 * Picks up payments that stopped part-way and would otherwise hold their budget until PayPal expires the hold:
 * a hold, capture or void interrupted after its claim, and a capture PayPal declined (retried, then released).
 * Unscoped, it runs from the cron and at most once a minute from a page load; scoped to a mandate, from that mandate's
 * own agent and shopper calls, so nobody's call does PayPal work for someone else.
 * Every path is bounded, and a row past its limit is no longer picked, so it can't crowd out the others: holds and
 * captures stop after MAX_RESUME_ATTEMPTS failed resumes (no answer from PayPal), captures after MAX_CAPTURE_ATTEMPTS
 * declines (then the hold is released), voids after MAX_VOID_ATTEMPTS refusals. Each failure is in the ledger.
 */
export async function resumeStuckPayments(deps: PaymentDeps, scope: { mandateId?: string; limit?: number } = {}): Promise<Payment[]> {
  const before = new Date(nowOf(deps).getTime() - STALE_CLAIM_MS);
  const events = (types: string[]) =>
    sql`(select count(*) from ${ledgerEvents} where ${ledgerEvents.paymentId} = ${payments.id} and ${ledgerEvents.type} in (${sql.join(
      types.map((t) => sql`${t}`),
      sql`, `,
    )}))`;
  const unanswered = events(["resume.failed", "capture.unanswered"]);
  const voidsRefused = events(["void.failed"]);
  const declines = events(["capture.failed"]);
  const stuck = await deps.db
    .select()
    .from(payments)
    .where(
      and(
        lte(payments.updatedAt, before),
        scope.mandateId ? eq(payments.mandateId, scope.mandateId) : undefined,
        sql`${unanswered} < ${MAX_RESUME_ATTEMPTS}`,
        or(
          inArray(payments.status, ["authorizing", "capturing"]),
          and(eq(payments.status, "voiding"), sql`${voidsRefused} < ${MAX_VOID_ATTEMPTS}`),
          and(
            eq(payments.status, "authorized"),
            sql`cardinality(${payments.anomalyFlags}) = 0`,
            or(sql`${declines} < ${MAX_CAPTURE_ATTEMPTS}`, sql`${voidsRefused} < ${MAX_VOID_ATTEMPTS}`),
          ),
        ),
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(scope.limit ?? 20);

  const results: Payment[] = [];
  for (const payment of stuck) {
    try {
      if (payment.status === "authorizing") results.push(await placeHold(deps, payment));
      else if (payment.status === "voiding") results.push(await voidPayment(deps, payment.id, "resumed", { resume: true }));
      else {
        // Capturing or authorized: the money may have moved already (an answer lost, or a capture made elsewhere).
        // PayPal's own record decides, before anything is captured again or voided.
        const auth = await getAuthorization(deps.platform, payment.paypalAuthorizationId!);
        const captured = ["CAPTURED", "PARTIALLY_CAPTURED"].includes(auth.status);
        results.push(await capturePayment(deps, payment.id, { resume: true, captured }));
      }
    } catch (error) {
      console.warn(`resuming payment ${payment.id} failed:`, error instanceof Error ? error.message : error);
      // To the back of the queue, and counted towards the limit.
      await deps.db
        .transaction(async (tx) => {
          const [moved] = await tx
            .update(payments)
            .set({ updatedAt: nowOf(deps) })
            .where(and(eq(payments.id, payment.id), eq(payments.status, payment.status)))
            .returning();
          if (moved) await logEvent(tx, moved, "resume.failed", nowOf(deps), { detail: { status: payment.status, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
        })
        .catch(() => {});
    }
  }
  return results;
}

export type RevokeResult = { alreadyRevoked: boolean; voided: string[]; stillOpen: string[] };

/**
 * One tap: the mandate stops accepting requests the moment this commits (the evaluator denies on
 * mandate.revoked), then every open hold is voided. Holds still being placed void themselves when
 * they see the revoked mandate.
 */
/** `by` is recorded so the ledger shows whether the user or an agent (over MCP) pulled the plug (R9). */
export async function revokeMandate(deps: PaymentDeps, mandateId: string, by: "user" | "agent" = "user"): Promise<RevokeResult> {
  const now = nowOf(deps);
  const { alreadyRevoked, open } = await deps.db.transaction(async (tx) => {
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, mandateId)).for("no key update");
    if (!mandate) throw new Error(`mandate ${mandateId} not found`);
    const alreadyRevoked = mandate.status === "revoked";
    if (!alreadyRevoked) {
      await tx.update(mandates).set({ status: "revoked", revokedAt: now }).where(eq(mandates.id, mandateId));
      await tx.insert(ledgerEvents).values({
        mandateId,
        mandateHash: mandate.hash,
        type: "mandate.revoked",
        detail: { by },
        createdAt: now,
      });
    }
    const open = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.mandateId, mandateId), inArray(payments.status, [...OPEN_HOLD])));
    return { alreadyRevoked, open };
  });

  const results = await Promise.all(open.map((p) => voidPayment(deps, p.id, "mandate_revoked")));
  return {
    alreadyRevoked,
    voided: results.filter((p) => p.status === "voided").map((p) => p.id),
    stillOpen: results.filter((p) => p.status !== "voided").map((p) => p.id),
  };
}
