import type { Metadata } from "next";
import { RevokeButton } from "@/components/app/RevokeButton";
import { Meter, PageHeader, Section } from "@/components/app/ui";
import { describePolicy, formatCents } from "@/lib/policy/describe";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rules" };

const PERIOD: Record<string, string> = { run: "Each shopping run", day: "Today", week: "This week", month: "This month" };

export default async function RulesPage() {
  const { mandate, spent } = await requireData();
  const { policy } = mandate;
  const active = mandate.status === "active";

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

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section label="You wrote" title="In your words">
            <blockquote className="border-l-2 border-accent pl-5 text-[1.15rem] leading-relaxed tracking-[-0.01em]">&ldquo;{mandate.statement}&rdquo;</blockquote>
          </Section>

          <Section label="Enforced" title="The rules Chaperone checks">
            <ul className="divide-y divide-line border-y border-line">
              {describePolicy(policy).map((line) => (
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
