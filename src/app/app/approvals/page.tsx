import type { Metadata } from "next";
import Link from "next/link";
import { ActivityList, when } from "@/components/app/Activity";
import { ApprovalLink } from "@/components/app/ApprovalLink";
import { PageHeader, Section } from "@/components/app/ui";
import { shopLabel } from "@/lib/payments/messages";
import { formatCents } from "@/lib/policy/describe";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { mandate, recent, waiting, deadlines } = await requireData();
  const { policy } = mandate;
  const line = policy.approvalThresholdCents;
  const decided = recent.filter((p) => p.decision === "needs_approval" && p.status !== "pending_approval");

  return (
    <div className="space-y-12">
      <PageHeader label="Approvals" title={waiting.length ? "Your agent is waiting for your OK." : "Nothing is waiting for you."}>
        {line !== null ? `Anything over ${formatCents(line)} ` : "Anything your rules flag "}
        stops here as a PayPal hold: the money is set aside but not paid. Approve it and the shop is paid; reject it, or leave it for a day, and the hold is released.
      </PageHeader>

      <Section label="Needs you" title="Waiting">
        {waiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-6 text-ink-2">
            Nothing to approve.{" "}
            <Link href="/app/shop" className="text-ink underline decoration-line-strong underline-offset-4">
              Send the agent shopping
            </Link>{" "}
            and anything over your line lands here.
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {waiting.map((p) => (
              <li key={p.id} className="rounded-2xl border border-ink p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[1.15rem] font-semibold tracking-[-0.02em]">
                    {shopLabel(policy, p.payeeMerchantId)} · {formatCents(p.totalCents)}
                  </p>
                  <p className="label text-ink-2">Released {when(deadlines.get(p.id) ?? p.createdAt)}</p>
                </div>
                <ul className="mt-3 space-y-1 text-[0.95rem] text-ink-2">
                  {p.items.map((i) => (
                    <li key={`${i.title}-${i.quantity}`}>
                      {i.quantity}× {i.title} · {formatCents(i.unitPriceCents * i.quantity)}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[0.88rem] text-ink-3">Rule: {p.clauseText}</p>
                <ApprovalLink paymentId={p.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="History" title="Already decided">
        <ActivityList payments={decided} policy={policy} empty="Nothing decided yet." />
      </Section>
    </div>
  );
}
