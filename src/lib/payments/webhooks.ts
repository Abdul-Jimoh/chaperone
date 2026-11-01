import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { ledgerEvents, payments, webhookEvents } from "@/db/schema";
import { releaseReservation, settleReservation, type Payment } from "@/lib/ledger/reserve";
import type { WebhookEvent } from "@/lib/paypal/webhooks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Resource = WebhookEvent["resource"] & {
  custom_id?: string;
  invoice_id?: string;
  supplementary_data?: { related_ids?: { authorization_id?: string } };
  purchase_units?: { custom_id?: string }[];
};

export type WebhookOutcome = "duplicate" | "unmatched" | "recorded" | "applied";

/** The authorization this event is about, as PayPal states it. */
function authorizationIdOf(event: WebhookEvent): string | undefined {
  const r = event.resource as Resource;
  if (event.event_type.startsWith("PAYMENT.AUTHORIZATION.")) return r.id;
  return r.supplementary_data?.related_ids?.authorization_id;
}

async function findPayment(tx: Tx, event: WebhookEvent): Promise<Payment | undefined> {
  const r = event.resource as Resource;
  const ours = [r.custom_id, r.invoice_id, r.purchase_units?.[0]?.custom_id].find((v) => v && UUID.test(v));
  const authId = authorizationIdOf(event);
  const where = ours ? eq(payments.id, ours) : authId ? eq(payments.paypalAuthorizationId, authId) : undefined;
  if (!where) return undefined;
  const [payment] = await tx.select().from(payments).where(where).for("update");
  // Our id in custom_id must agree with the authorization PayPal says the event is about.
  if (payment && authId && payment.paypalAuthorizationId && payment.paypalAuthorizationId !== authId) return undefined;
  return payment;
}

function flag(payment: Payment, name: string) {
  return payment.anomalyFlags.includes(name) ? payment.anomalyFlags : [...payment.anomalyFlags, name];
}

/**
 * Applies a verified PayPal event to the ledger. Webhooks confirm or complete what the payment
 * service started (e.g. a capture whose response was lost); they never start a payment, and a
 * redelivered event is a no-op.
 */
export async function applyWebhookEvent(db: Db, event: WebhookEvent, now = new Date()): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        id: event.id,
        eventType: event.event_type,
        resourceId: event.resource.id ?? null,
        verified: true,
        payload: event,
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!inserted.length) return "duplicate";

    const payment = await findPayment(tx, event);
    let outcome: WebhookOutcome = payment ? "recorded" : "unmatched";

    if (payment) {
      const resourceId = event.resource.id;
      const update: Partial<typeof payments.$inferInsert> = {};

      switch (event.event_type) {
        case "PAYMENT.AUTHORIZATION.VOIDED":
          // Covers voids we didn't send ourselves too, e.g. PayPal expiring the hold after 29 days.
          if (["authorizing", "authorized", "pending_approval", "voiding"].includes(payment.status)) {
            update.status = "voided";
            await releaseReservation(tx, payment.id, now);
          }
          break;
        case "PAYMENT.CAPTURE.COMPLETED":
          if (payment.status === "capturing") {
            update.status = "captured";
          } else if (payment.status === "authorized" || payment.status === "pending_approval") {
            update.status = "captured";
            update.anomalyFlags = flag(payment, "unexpected_capture");
          }
          if (update.status) {
            update.paypalCaptureId = resourceId ?? payment.paypalCaptureId;
            await settleReservation(tx, payment.id, now);
          }
          break;
        case "PAYMENT.CAPTURE.DENIED":
          update.anomalyFlags = flag(payment, "capture_denied");
          break;
        case "PAYMENT.CAPTURE.REVERSED":
          update.anomalyFlags = flag(payment, "capture_reversed");
          break;
        case "PAYMENT.CAPTURE.REFUNDED":
          update.anomalyFlags = flag(payment, "refunded");
          break;
      }

      if (Object.keys(update).length) {
        await tx.update(payments).set({ ...update, updatedAt: now }).where(eq(payments.id, payment.id));
        outcome = "applied";
      }
      await tx.insert(ledgerEvents).values({
        mandateId: payment.mandateId,
        mandateHash: payment.mandateHash,
        paymentId: payment.id,
        type: `paypal.${event.event_type.toLowerCase()}`,
        paypalResourceId: resourceId ?? null,
        detail: { webhookEventId: event.id, status: (event.resource as { status?: string }).status ?? null },
        createdAt: now,
      });
    }

    await tx.update(webhookEvents).set({ processedAt: now }).where(eq(webhookEvents.id, event.id));
    return outcome;
  });
}
