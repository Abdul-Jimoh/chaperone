import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import { approvals, ledgerEvents, payments } from "@/db/schema";
import type { Payment } from "@/lib/ledger/reserve";
import { sha256Hex } from "@/lib/policy/canonical";
import { capturePayment, resumeStuckPayments, voidPayment, type PaymentDeps } from "./service";

export type ApprovalDeps = PaymentDeps & { approvalSecret: string };

// The link only has to survive the walk from the inbox to the phone; the approval itself lasts longer
// (APPROVAL_TIMEOUT_MS) and the inbox can issue a fresh link any time before then.
export const APPROVAL_LINK_TTL_MS = 30 * 60 * 1000;

const AUDIENCE = "chaperone:approval";

export class InvalidApprovalLinkError extends Error {}

function key(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("APPROVAL_LINK_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

function nowOf(deps: PaymentDeps): Date {
  return deps.clock?.() ?? new Date();
}

/**
 * Issues a new link for a pending approval and invalidates any earlier one. Call this only from
 * the user's own session (inbox, notification): a link in the agent's hands would let it approve itself.
 */
export async function issueApprovalLink(
  deps: ApprovalDeps,
  paymentId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const now = nowOf(deps);
  return deps.db.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.paymentId, paymentId), isNull(approvals.decidedAt)))
      .for("no key update");
    if (!approval || approval.expiresAt <= now) return null;
    const expiresAt = new Date(Math.min(now.getTime() + APPROVAL_LINK_TTL_MS, approval.expiresAt.getTime()));
    const token = await new SignJWT({ pid: paymentId })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(AUDIENCE)
      .setJti(randomBytes(16).toString("base64url"))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(key(deps.approvalSecret));
    await tx.update(approvals).set({ tokenHash: sha256Hex(token) }).where(eq(approvals.id, approval.id));
    return { token, expiresAt };
  });
}

async function verifyLink(deps: ApprovalDeps, token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, key(deps.approvalSecret), {
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: nowOf(deps),
    });
    if (typeof payload.pid !== "string") throw new InvalidApprovalLinkError("link has no payment");
    return payload.pid;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw new InvalidApprovalLinkError("This link has expired.");
    if (error instanceof joseErrors.JOSEError) throw new InvalidApprovalLinkError("This link is not valid.");
    throw error;
  }
}

/** What the approval page shows before the user taps. Doesn't consume the link. */
export async function viewApproval(deps: ApprovalDeps, token: string): Promise<{ payment: Payment; expiresAt: Date }> {
  const paymentId = await verifyLink(deps, token);
  const [row] = await deps.db
    .select({ approval: approvals, payment: payments })
    .from(approvals)
    .innerJoin(payments, eq(payments.id, approvals.paymentId))
    .where(and(eq(approvals.paymentId, paymentId), eq(approvals.tokenHash, sha256Hex(token))));
  if (!row) throw new InvalidApprovalLinkError("This link has been replaced or used.");
  return { payment: row.payment, expiresAt: row.approval.expiresAt };
}

export type ApprovalChoice = "approve" | "reject";

/**
 * Single use: the first tap records the outcome and every later use of the link is refused.
 * Approve captures the hold; reject (or an approval past its timeout) voids it.
 */
export async function decideApproval(deps: ApprovalDeps, token: string, choice: ApprovalChoice): Promise<Payment> {
  const paymentId = await verifyLink(deps, token);
  const now = nowOf(deps);

  const outcome = await deps.db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("no key update");
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.paymentId, paymentId), eq(approvals.tokenHash, sha256Hex(token))))
      .for("no key update");
    if (!payment || !approval || approval.decidedAt) {
      throw new InvalidApprovalLinkError("This link has been replaced or used.");
    }
    const expired = approval.expiresAt <= now;
    // A revoke may already have voided the hold; the tap is then recorded but changes nothing.
    const open = payment.status === "pending_approval";
    const result = expired ? "expired" : choice === "approve" ? "approved" : "rejected";
    await tx.update(approvals).set({ outcome: result, decidedAt: now }).where(eq(approvals.id, approval.id));
    if (open && result === "approved") {
      await tx.update(payments).set({ status: "authorized", updatedAt: now }).where(eq(payments.id, paymentId));
    }
    await tx.insert(ledgerEvents).values({
      mandateId: payment.mandateId,
      mandateHash: payment.mandateHash,
      paymentId,
      type: `approval.${result}`,
      amountCents: payment.totalCents,
      createdAt: now,
    });
    return { result, open };
  });

  if (!outcome.open) return (await deps.db.select().from(payments).where(eq(payments.id, paymentId)))[0]!;
  if (outcome.result === "approved") return capturePayment(deps, paymentId);
  return voidPayment(deps, paymentId, outcome.result === "expired" ? "approval_expired" : "rejected");
}

/**
 * Serverless has no timer, so approvals that were answered or ran out are applied lazily, and stuck payments resumed
 * (resumeStuckPayments). With a mandate, only that mandate's: an agent's or shopper's own call, which needs its budget
 * current before deciding. Without one, everyone's: the daily cron, and a page load at most once a minute. So one
 * shopper's call never does PayPal work for anyone else.
 */
export async function sweepApprovals(deps: PaymentDeps, scope: { mandateId?: string } = {}): Promise<Payment[]> {
  const now = nowOf(deps);
  const due = await deps.db
    .select({ approval: approvals, payment: payments })
    .from(approvals)
    .innerJoin(payments, eq(payments.id, approvals.paymentId))
    .where(
      and(
        eq(payments.status, "pending_approval"),
        scope.mandateId ? eq(payments.mandateId, scope.mandateId) : undefined,
        or(and(isNull(approvals.decidedAt), lte(approvals.expiresAt, now)), isNotNull(approvals.decidedAt)),
      ),
    );

  const results: Payment[] = [];
  for (const { approval, payment } of due) {
    let outcome = approval.outcome;
    if (approval.decidedAt === null) {
      const [expired] = await deps.db
        .update(approvals)
        .set({ outcome: "expired", decidedAt: now })
        .where(and(eq(approvals.id, approval.id), isNull(approvals.decidedAt)))
        .returning();
      // Someone tapped in the meantime; their decision stands.
      if (!expired) continue;
      outcome = "expired";
      await deps.db.insert(ledgerEvents).values({
        mandateId: payment.mandateId,
        mandateHash: payment.mandateHash,
        paymentId: payment.id,
        type: "approval.expired",
        amountCents: payment.totalCents,
        createdAt: now,
      });
    }
    if (outcome === "approved") continue;
    results.push(await voidPayment(deps, payment.id, outcome === "rejected" ? "rejected" : "approval_expired"));
  }
  // A mandate's own calls move only its own stuck payments, a few at a time.
  results.push(...(await resumeStuckPayments(deps, scope.mandateId ? { mandateId: scope.mandateId, limit: 2 } : {})));
  return results;
}
