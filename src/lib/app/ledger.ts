import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerEvents, mandates, payments } from "@/db/schema";
import { budgetWindow, type LedgerRow } from "@/lib/app/ledger-rows";
import { shopLabel } from "@/lib/payments/messages";

/** Every payment under any mandate this user signed, with its trail. Only this user's mandates are read. */
export async function ledgerFor(db: Db, userId: string): Promise<LedgerRow[]> {
  const own = await db.select().from(mandates).where(eq(mandates.userId, userId));
  const policies = new Map(own.map((m) => [m.id, m.policy]));
  const signed = new Map(own.map((m) => [m.id, `Signed ${m.issuedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${m.hash.slice(0, 8)}${m.status === "revoked" ? " · revoked" : ""}`]));
  const rows = own.length
    ? await db.select().from(payments).where(inArray(payments.mandateId, [...policies.keys()])).orderBy(desc(payments.createdAt))
    : [];
  const events = rows.length
    ? await db.select().from(ledgerEvents).where(inArray(ledgerEvents.paymentId, rows.map((r) => r.id))).orderBy(asc(ledgerEvents.createdAt))
    : [];

  return rows.map((p) => ({
    id: p.id,
    at: p.createdAt.toISOString(),
    shop: shopLabel(policies.get(p.mandateId)!, p.payeeMerchantId),
    items: p.items.map((i) => `${i.quantity}× ${i.title}`).join(", "),
    totalCents: p.totalCents,
    decision: p.decision,
    rule: p.clauseText,
    status: p.status,
    source: p.source,
    mandateId: p.mandateId,
    mandateHash: p.mandateHash,
    mandateLabel: signed.get(p.mandateId)!,
    ...budgetWindow(policies.get(p.mandateId)!, p.createdAt),
    anomalies: p.anomalyFlags,
    events: events
      .filter((e) => e.paymentId === p.id)
      .map((e) => ({
        at: e.createdAt.toISOString(),
        type: e.type,
        amountCents: e.amountCents,
        detail: e.paypalResourceId ? `PayPal id ${e.paypalResourceId}` : "",
      })),
  }));
}
