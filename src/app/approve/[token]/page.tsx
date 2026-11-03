import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { mandates } from "@/db/schema";
import { Logo } from "@/components/brand/Logo";
import { InvalidApprovalLinkError, viewApproval } from "@/lib/payments/approvals";
import { shopLabel } from "@/lib/payments/messages";
import { formatCents } from "@/lib/policy/describe";
import { paymentDeps } from "@/lib/server";
import { Decision } from "./Decision";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve a purchase", robots: { index: false } };

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deps = paymentDeps();
  let view;
  try {
    view = await viewApproval(deps, token);
  } catch (error) {
    if (!(error instanceof InvalidApprovalLinkError)) throw error;
    return (
      <Shell>
        <h1 className="display text-[2.2rem]">This link can&apos;t be used.</h1>
        <p className="mt-3 text-ink-2">{error.message} Open the dashboard to get a fresh link if the purchase is still waiting.</p>
        <Link href="/app" className="mt-6 inline-flex h-12 items-center rounded-full bg-ink px-6 text-paper">
          Go to the dashboard
        </Link>
      </Shell>
    );
  }

  const { payment, expiresAt } = view;
  const [mandate] = await deps.db.select({ policy: mandates.policy }).from(mandates).where(eq(mandates.id, payment.mandateId));
  const shop = mandate ? shopLabel(mandate.policy, payment.payeeMerchantId) : "A shop";
  const open = payment.status === "pending_approval";

  return (
    <Shell>
      <p className="label text-ink-2">Your agent wants to buy</p>
      <h1 className="mt-3 text-[3rem] font-semibold leading-none tracking-tighter">{formatCents(payment.totalCents)}</h1>
      <p className="mt-2 text-[1.15rem]">from {shop}</p>

      <ul className="mt-6 divide-y divide-line border-y border-line">
        {payment.items.map((i) => (
          <li key={i.title} className="flex justify-between gap-4 py-3">
            <span>
              {i.title} <span className="text-ink-3">×{i.quantity}</span>
            </span>
            <span className="tabular-nums">{formatCents(i.unitPriceCents * i.quantity)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-xl bg-paper-2 p-4 text-[0.95rem] text-ink-2">
        <span className="font-medium text-ink">Why you&apos;re being asked:</span> {payment.clauseText}. The money is on hold, not charged.
      </p>

      <div className="mt-8">
        {open ? (
          <Decision token={token} deadline={expiresAt.toISOString().slice(0, 16).replace("T", " ")} />
        ) : (
          <p className="rounded-xl bg-paper-2 p-4">This purchase was already decided (status: {payment.status}).</p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col px-5 py-8">
      <Link href="/" aria-label="Chaperone home" className="mb-10 text-[1.05rem]">
        <Logo />
      </Link>
      {children}
    </main>
  );
}
