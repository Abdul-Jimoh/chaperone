import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { approvals, ledgerEvents, mandates, paymentMethods, payments } from "@/db/schema";
import { paypalRequestId } from "@/lib/ledger/idempotency";
import { decideAndReserve, releaseReservation, settleReservation, type Payment } from "@/lib/ledger/reserve";
import { PayPalError, type PayPalClient } from "@/lib/paypal/client";
import { toCents } from "@/lib/paypal/money";
import { createAuthorizeOrder, firstAuthorization } from "@/lib/paypal/orders";
import { voidHold, type PayeeClients } from "@/lib/paypal/payees";
import { captureAuthorization } from "@/lib/paypal/payments";
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
    // Only a definite PayPal answer means no hold exists; a network failure leaves the row for a retry.
    if (error instanceof PayPalError) return failAuthorizing(deps, payment, "hold.failed", paypalDetail(error));
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
  if (payee !== undefined && payee !== payment.payeeMerchantId) anomalies.push("payee_mismatch");
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
export async function capturePayment(deps: PaymentDeps, paymentId: string): Promise<Payment> {
  const now = nowOf(deps);
  const claim = await deps.db.transaction(async (tx) => {
    const current = await getPayment(tx, paymentId);
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, current.mandateId)).for("no key update");
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("no key update");
    if (payment!.status !== "authorized") return { kind: "skip" as const, payment: payment! };
    if (mandate!.status === "revoked") return { kind: "revoked" as const, payment: payment! };
    if (payment!.anomalyFlags.length) throw new CaptureNotAllowedError(`payment ${paymentId} has anomalies`);
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
  const payment = claim.payment;

  let capture;
  try {
    capture = await captureAuthorization(deps.platform, payment.paypalAuthorizationId!, {
      requestId: paypalRequestId(payment.idempotencyKey, "capture"),
    });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    return deps.db.transaction(async (tx) => {
      const [back] = await tx
        .update(payments)
        .set({ status: "authorized", updatedAt: nowOf(deps) })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "capturing")))
        .returning();
      await logEvent(tx, payment, "capture.failed", nowOf(deps), { detail: paypalDetail(error) });
      return back ?? getPayment(tx, paymentId);
    });
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

export type VoidReason = "rejected" | "approval_expired" | "mandate_revoked";

/** Releases an open hold with the payee shop's credentials and gives the budget back. */
export async function voidPayment(deps: PaymentDeps, paymentId: string, reason: VoidReason): Promise<Payment> {
  const now = nowOf(deps);
  const claim = await deps.db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("no key update");
    if (!payment || !(OPEN_HOLD as readonly string[]).includes(payment.status)) return null;
    const [claimed] = await tx
      .update(payments)
      .set({ status: "voiding", updatedAt: now })
      .where(eq(payments.id, paymentId))
      .returning();
    return { payment: claimed!, previous: payment.status as (typeof OPEN_HOLD)[number] };
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
