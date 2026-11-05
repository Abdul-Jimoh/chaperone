import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/AppHeader";
import { LedgerGrid, type LedgerRow } from "@/components/app/LedgerGrid";
import { SHELL } from "@/components/app/ui";
import { ledgerEvents, mandates, payments } from "@/db/schema";
import { sessionUserId } from "@/lib/app/session";
import { shopLabel } from "@/lib/payments/messages";
import { serverDb } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  const userId = await sessionUserId();
  if (!userId) redirect("/app");
  const db = serverDb();

  const own = await db.select().from(mandates).where(eq(mandates.userId, userId));
  const policies = new Map(own.map((m) => [m.id, m.policy]));
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
    mandateHash: p.mandateHash,
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
    <>
      <AppHeader signedIn />
      <main className={`${SHELL} py-10 lg:py-14`}>
        <p className="label text-ink-2">Ledger</p>
        <h1 className="display mt-3 max-w-5xl text-[clamp(2rem,4.4vw,3.6rem)]">Every payment, the rule behind it, and what PayPal did.</h1>
        <p className="mt-4 max-w-2xl text-ink-2">
          Each row was checked against the signed mandate whose hash it stores. Sort or filter any column; select a row for its full trail.
        </p>
        <div className="mt-8">
          <LedgerGrid rows={data} />
        </div>
      </main>
    </>
  );
}
