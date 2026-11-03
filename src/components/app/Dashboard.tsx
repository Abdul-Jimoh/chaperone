import type { dashboard } from "@/lib/app/demo";
import { shopLabel } from "@/lib/payments/messages";
import { describePolicy, formatCents } from "@/lib/policy/describe";
import { AgentKey } from "./AgentKey";
import { ApprovalLink } from "./ApprovalLink";
import { RevokeButton } from "./RevokeButton";
import { Simulator } from "./Simulator";
import { Card, decisionLabel, Meter, StatusPill } from "./ui";

type Data = NonNullable<Awaited<ReturnType<typeof dashboard>>>;

const time = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export function Dashboard({ data }: { data: Data }) {
  const { mandate, spent, recent, waiting, deadlines } = data;
  const { policy } = mandate;
  const active = mandate.status === "active";
  const month = policy.budgets.find((b) => b.period === "month");

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ink-2">Dashboard</p>
          <h1 className="display mt-3 text-[clamp(2rem,4.4vw,3.2rem)]">{active ? "Your agent is shopping under these rules." : "This mandate is revoked."}</h1>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[0.9rem] font-medium ${active ? "bg-mint text-go" : "bg-ink text-paper"}`}>
          {active ? "Mandate active" : "Revoked: every request is denied"}
        </span>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card label="Try it" title="Let the agent try a purchase">
            <p className="mb-5 leading-relaxed text-ink-2">
              Each button sends a cart through the same checks a real agent gets, with real PayPal sandbox holds.
            </p>
            <Simulator disabled={!active} />
          </Card>

          {waiting.length > 0 && (
            <Card label="Needs you" title="Waiting for your OK">
              <ul className="space-y-4">
                {waiting.map((p) => (
                  <li key={p.id} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">
                        {shopLabel(policy, p.payeeMerchantId)} · {formatCents(p.totalCents)}
                      </p>
                      <p className="label text-ink-2">Cancels {time(deadlines.get(p.id) ?? p.createdAt)} if you don&apos;t answer</p>
                    </div>
                    <p className="mt-1 text-[0.92rem] text-ink-2">{p.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}</p>
                    <ApprovalLink paymentId={p.id} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card label="Activity" title="Every request, and the rule that decided it">
            {recent.length === 0 ? (
              <p className="text-ink-2">Nothing yet. Let the agent try a purchase above.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {shopLabel(policy, p.payeeMerchantId)} · {formatCents(p.totalCents)}
                        <span className="text-ink-2"> · {decisionLabel(p.decision)}</span>
                      </p>
                      <p className="truncate text-[0.88rem] text-ink-2">
                        {time(p.createdAt)} · {p.clauseText}
                      </p>
                    </div>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card label="Budget" title="This month">
            {month && (
              <>
                <p className="text-[2rem] font-semibold tracking-[-0.04em]">
                  {formatCents(spent.month ?? 0)} <span className="text-[1rem] font-normal text-ink-2">of {formatCents(month.limitCents)}</span>
                </p>
                <div className="mt-3">
                  <Meter used={spent.month ?? 0} limit={month.limitCents} />
                </div>
                <p className="mt-3 text-[0.88rem] text-ink-2">Held and paid purchases count. Cancelled holds give the money back.</p>
              </>
            )}
          </Card>

          <Card label="Mandate" title="Your rules">
            <ul className="space-y-2 text-[0.95rem]">
              {describePolicy(policy).map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-[0.75rem] break-all text-ink-3">sha256 {mandate.hash}</p>
            {active && (
              <div className="mt-5">
                <RevokeButton />
              </div>
            )}
          </Card>

          <Card label="Developers" title="Connect your own agent">
            <p className="mb-4 text-[0.95rem] leading-relaxed text-ink-2">
              Any MCP agent can pay under this mandate with a key. The key fixes the mandate; the agent can&apos;t pick a looser one.
            </p>
            <AgentKey disabled={!active} />
          </Card>
        </div>
      </div>
    </div>
  );
}
