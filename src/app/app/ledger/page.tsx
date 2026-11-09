import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { LedgerGrid, type LedgerRow } from "@/components/app/LedgerGrid";
import { PageHeader } from "@/components/app/ui";
import { budgetWindow } from "@/lib/app/ledger-rows";
import { ledgerEvents, mandates, payments } from "@/db/schema";
import { shopLabel } from "@/lib/payments/messages";
import { serverDb } from "@/lib/server";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  const { mandate } = await requireData();
  const userId = mandate.userId;
  const db = serverDb();

  const own = await db.select().from(mandates).where(eq(mandates.userId, userId));
  const policies = new Map(own.map((m) => [m.id, m.policy]));
  const signed = new Map(own.map((m) => [m.id, `Signed ${m.issuedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${m.hash.slice(0, 8)}${m.status === "revoked" ? " · revoked" : ""}`]));
  const rows = own.length
    ? await db.select().from(payments).where(inArray(payments.mandateId, [...policies.keys()])).orderBy(desc(payments.createdAt))
    : [];
  const events = rows.length
    ? await db.select().from(ledgerEvents).where(inArray(ledgerEvents.paymentId, rows.map((r) => r.id))).orderBy(asc(ledgerEvents.createdAt))
    : [];

  const data: LedgerRow[] = rows.map((p) => ({
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

  return (
    <div className="space-y-8">
      <PageHeader label="Ledger" title="Every payment, the rule behind it, and what PayPal did.">
        Each row was checked against the signed mandate whose hash it stores. Group by shop, budget window, decision or the rules that were signed; click a payment for its full trail.
      </PageHeader>
      <LedgerGrid rows={data} />
    </div>
  );
}
