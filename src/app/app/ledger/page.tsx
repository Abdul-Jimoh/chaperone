import type { Metadata } from "next";
import { LedgerGrid } from "@/components/app/LedgerGrid";
import { PageHeader } from "@/components/app/ui";
import { ledgerFor } from "@/lib/app/ledger";
import { serverDb } from "@/lib/server";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  const { mandate } = await requireData();
  const data = await ledgerFor(serverDb(), mandate.userId);

  return (
    <div className="space-y-8">
      <PageHeader label="Ledger" title="Every payment, the rule behind it, and what PayPal did.">
        Each row was checked against the signed mandate whose hash it stores. Group by shop, budget window, decision or the rules that were signed; click a payment for its full trail.
      </PageHeader>
      <LedgerGrid rows={data} />
    </div>
  );
}
