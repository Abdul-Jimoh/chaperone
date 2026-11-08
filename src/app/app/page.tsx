import type { Metadata } from "next";
import Link from "next/link";
import { ActivityList } from "@/components/app/Activity";
import { Onboarding } from "@/components/app/Onboarding";
import { StartScreen } from "@/components/app/StartScreen";
import { Meter, PageHeader, Section } from "@/components/app/ui";
import { DEMO_STATEMENT } from "@/lib/demo";
import { formatCents } from "@/lib/policy/describe";
import { appData, type AppData } from "./data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo" };

function steps({ recent, agents }: AppData) {
  return [
    {
      href: "/app/shop",
      title: "Send the agent shopping",
      body: "Claude searches three shops for dog food, paper towels and dish soap, and asks Chaperone to pay.",
      done: recent.some((p) => p.runId?.startsWith("agent-")),
    },
    {
      href: "/app/approvals",
      title: "Approve what's over your line",
      body: "Anything over $40 waits as a PayPal hold. Approve it on your phone; the hold is captured or released.",
      done: recent.some((p) => p.decision === "needs_approval" && p.status !== "pending_approval"),
    },
    {
      href: "/app/shop#test",
      title: "Send the tricked cart",
      body: "What an agent fooled by a listing would send: ten bags, to a shop you never listed. It's blocked.",
      done: recent.some((p) => p.decision === "deny"),
    },
    {
      href: "/app/connect",
      title: "Connect your own agent",
      body: "Add Chaperone to Claude Code or any MCP client, sign in, and let it shop under the same rules.",
      done: recent.some((p) => p.source === "mcp") || agents.length > 0,
    },
  ];
}

export default async function AppPage() {
  const { userId, data } = await appData();
  if (!userId) return <StartScreen />;
  if (!data) return <Onboarding example={DEMO_STATEMENT} />;

  const { mandate, spent, recent, waiting } = data;
  const active = mandate.status === "active";
  const month = mandate.policy.budgets.find((b) => b.period === "month");
  const paid = recent.filter((p) => p.status === "captured").length;
  const blocked = recent.filter((p) => p.decision === "deny").length;
  const title = !active
    ? "These rules are revoked. Every request is denied."
    : waiting.length
    ? `${waiting.length === 1 ? "One purchase is" : `${waiting.length} purchases are`} waiting for you.`
    : "Your agent shops. You hold the money.";
  const guide = steps(data);
  const next = guide.find((s) => !s.done);

  return (
    <div className="space-y-12">
      <PageHeader
        label="Overview"
        title={title}
        action={
          waiting.length > 0 ? (
            <Link href="/app/approvals" className="inline-flex h-11 shrink-0 items-center rounded-full bg-accent px-5 font-medium text-paper hover:bg-accent-ink">
              Review {waiting.length === 1 ? "it" : "them"}
            </Link>
          ) : next && active ? (
            <Link href={next.href} className="inline-flex h-11 shrink-0 items-center rounded-full bg-ink px-5 font-medium text-paper hover:bg-accent">
              {next.title}
            </Link>
          ) : null
        }
      >
        Every payment your agent asks for is checked against the rules you signed, then held, paid or blocked in PayPal&apos;s sandbox.
      </PageHeader>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
        <div className="col-span-3 bg-paper p-5 lg:col-span-1">
          <p className="text-[0.86rem] text-ink-2">Spent this month</p>
          <p className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em]">
            {formatCents(spent.month ?? 0)}
            {month && <span className="text-[0.95rem] font-normal text-ink-2"> of {formatCents(month.limitCents)}</span>}
          </p>
          {month && (
            <div className="mt-3">
              <Meter used={spent.month ?? 0} limit={month.limitCents} />
            </div>
          )}
        </div>
        {[
          ["Waiting", waiting.length, "/app/approvals"],
          ["Paid", paid, "/app/ledger"],
          ["Blocked", blocked, "/app/ledger"],
        ].map(([label, value, href]) => (
          <Link key={label} href={String(href)} className="bg-paper p-4 hover:bg-paper-2 sm:p-5">
            <p className="text-[0.86rem] text-ink-2">{label}</p>
            <p className={`mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] ${label === "Waiting" && Number(value) > 0 ? "text-accent-ink" : ""}`}>{value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section label="Try it" title="Four steps, about three minutes">
          <ol className="space-y-2">
            {guide.map((step, i) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className={`group flex gap-4 rounded-2xl border p-4 transition-colors ${step === next ? "border-ink" : "border-line hover:border-line-strong"}`}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-[0.8rem] font-semibold ${
                      step.done ? "bg-go text-paper" : step === next ? "bg-ink text-paper" : "border border-line-strong text-ink-2"
                    }`}
                    aria-label={step.done ? "Done" : undefined}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold tracking-[-0.015em]">{step.title}</span>
                    <span className="mt-0.5 block text-[0.92rem] leading-relaxed text-ink-2">{step.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          label="Activity"
          title="Latest requests"
          action={
            <Link href="/app/ledger" className="text-[0.92rem] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              Full ledger
            </Link>
          }
        >
          <ActivityList payments={recent.slice(0, 6)} policy={mandate.policy} empty="Nothing yet. Send the agent shopping to see its first request here." />
        </Section>
      </div>
    </div>
  );
}
