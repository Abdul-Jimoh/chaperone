import type { Metadata } from "next";
import Link from "next/link";
import { LinkPayPal } from "@/components/app/LinkPayPal";
import { RevokeButton } from "@/components/app/RevokeButton";
import { Meter, PageHeader, Section } from "@/components/app/ui";
import { walletOf } from "@/lib/app/wallet";
import { describePolicy, formatCents, scheduleLine } from "@/lib/policy/describe";
import type { Policy } from "@/lib/policy/schema";
import { serverDb } from "@/lib/server";
import { appData, requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rules" };

function nextTrip(last: Date, { every, unit }: NonNullable<Policy["schedule"]>): Date {
  const next = new Date(last);
  if (unit === "month") next.setUTCMonth(next.getUTCMonth() + every);
  else next.setUTCDate(next.getUTCDate() + every * (unit === "week" ? 7 : 1));
  return next;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const PERIOD: Record<string, string> = { run: "Each shopping run", day: "Today", week: "This week", month: "This month" };

export default async function RulesPage() {
  const { mandate, spent, recent } = await requireData();
  const { userId } = await appData();
  const wallet = await walletOf(serverDb(), userId!);
  const { policy } = mandate;
  const active = mandate.status === "active";
  // A trip is a run of the in-app agent, or a day an MCP agent bought something (D27).
  const lastTrip = recent.find((p) => p.runId?.startsWith("agent-") || p.source === "mcp")?.createdAt;
  // After a revoke, a hold PayPal wouldn't release stays open until its authorization expires; say so.
  const stillHeld = active ? [] : recent.filter((p) => ["authorizing", "authorized", "pending_approval", "capturing", "voiding"].includes(p.status));
  const due = lastTrip && policy.schedule ? nextTrip(lastTrip, policy.schedule) : null;

  return (
    <div className="space-y-12">
      <PageHeader
        label="Rules"
        title={active ? "What your agent may spend, and where." : "These rules are revoked."}
        action={
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-[0.9rem] font-medium ${active ? "bg-mint text-go" : "bg-ink text-paper"}`}>
            {active ? "Active" : "Revoked: every request is denied"}
          </span>
        }
      >
        You wrote them in plain English, Claude turned them into these rules, and you confirmed them before they were signed. Claude never decides a payment: plain code
        checks every cart against exactly this.
      </PageHeader>

      {stillHeld.length > 0 && (
        <p role="status" className="rounded-xl bg-paper-2 p-4 text-[0.95rem] leading-relaxed">
          <span className="font-medium">
            {stillHeld.length === 1 ? "1 hold" : `${stillHeld.length} holds`} ({formatCents(stillHeld.reduce((sum, p) => sum + p.totalCents, 0))}) not released yet.
          </span>{" "}
          PayPal didn&apos;t confirm the release. Chaperone won&apos;t capture it; the money comes back when PayPal&apos;s authorization expires, and the Ledger shows
          each attempt.
        </p>
      )}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section label="You wrote" title="In your words">
            <blockquote className="border-l-2 border-accent pl-5 text-[1.15rem] leading-relaxed tracking-[-0.01em]">&ldquo;{mandate.statement}&rdquo;</blockquote>
          </Section>

          <Section label="Enforced" title="The rules Chaperone checks">
            <ul className="divide-y divide-line border-y border-line">
              {describePolicy(policy)
                .filter((line) => line !== scheduleLine(policy))
                .map((line) => (
                <li key={line} className="flex gap-3 py-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="space-y-12">
          <Section label="Budget" title="Spent so far">
            <ul className="space-y-5">
              {policy.budgets.map((b) => (
                <li key={b.period}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-2">{PERIOD[b.period] ?? b.period}</span>
                    <span className="font-medium">
                      {b.period === "run" ? `up to ${formatCents(b.limitCents)}` : `${formatCents(spent[b.period] ?? 0)} of ${formatCents(b.limitCents)}`}
                    </span>
                  </div>
                  {b.period !== "run" && (
                    <div className="mt-2">
                      <Meter used={spent[b.period] ?? 0} limit={b.limitCents} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[0.88rem] text-ink-2">Held and paid purchases count. A released hold gives the money back.</p>
          </Section>

          {policy.schedule && (
            <Section label="Schedule" title={policy.schedule.every === 1 ? `Once a ${policy.schedule.unit}` : `Every ${policy.schedule.every} ${policy.schedule.unit}s`}>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-[0.88rem] text-ink-2">Last trip</dt>
                  <dd className="mt-1 font-medium">{lastTrip ? day(lastTrip) : "Not yet"}</dd>
                </div>
                <div>
                  <dt className="text-[0.88rem] text-ink-2">Next trip due</dt>
                  <dd className="mt-1 font-medium">{due && due.getTime() > Date.now() ? day(due) : "Now"}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[0.88rem] leading-relaxed text-ink-2">
                A reminder, not a limit: Chaperone doesn&apos;t block a trip off schedule. In this demo you start each trip yourself, so no trip spends Claude credits while
                nobody is watching.
              </p>
              {active && (
                <Link href="/app/shop" className="mt-4 inline-flex h-10 items-center rounded-full border border-line-strong px-4 font-medium hover:border-ink">
                  Go shopping now
                </Link>
              )}
            </Section>
          )}

          <Section label="Pays with" title="PayPal wallet">
            <LinkPayPal wallet={wallet} />
          </Section>

          <Section label="Signed" title="The mandate itself">
            <p className="text-[0.95rem] leading-relaxed text-ink-2">
              Signed {mandate.issuedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} as an ES256 JWS. Every ledger row stores
              this hash, so each payment shows exactly which rules it was checked against.
            </p>
            <p className="mt-3 rounded-xl bg-paper-2 p-3 font-mono text-[0.75rem] break-all text-ink-2">sha256 {mandate.hash}</p>
          </Section>

          {active && (
            <Section label="Stop everything" title="Revoke">
              <p className="mb-4 text-[0.95rem] leading-relaxed text-ink-2">One tap: open holds are released and every later request is denied, from any agent.</p>
              <RevokeButton />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
