import { randomUUID } from "node:crypto";
import type { dashboard } from "@/lib/app/demo";
import { shopLabel } from "@/lib/payments/messages";
import { describePolicy, formatCents } from "@/lib/policy/describe";
import { DEMO_GOAL } from "@/lib/demo";
import { AgentKey } from "./AgentKey";
import { AgentRun } from "./AgentRun";
import { ApprovalLink } from "./ApprovalLink";
import { LiveRefresh } from "./LiveRefresh";
import { RevokeButton } from "./RevokeButton";
import { Simulator, type ScenarioCard } from "./Simulator";
import { Card, decisionLabel, Meter, SHELL, StatusPill } from "./ui";

type Data = NonNullable<Awaited<ReturnType<typeof dashboard>>>;

const TOOLS = [
  ["check_mandate", "Reads the rules, the shops and what's left to spend. Can preview a cart without reserving anything."],
  ["request_payment", "Asks to pay one shop for a cart. Returns paid, waiting for you, or blocked, and the rule that decided."],
  ["list_spend", "Lists what it has bought and the budget windows."],
  ["revoke_mandate", "Stops itself for good."],
] as const;

const time = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export function Dashboard({ data, scenarios }: { data: Data; scenarios: ScenarioCard[] }) {
  const { mandate, spent, recent, waiting, deadlines } = data;
  const { policy } = mandate;
  const active = mandate.status === "active";
  const month = policy.budgets.find((b) => b.period === "month");

  return (
    <div className={`${SHELL} py-10 lg:py-14`}>
      <LiveRefresh waiting={waiting.length > 0} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ink-2">Dashboard</p>
          <h1 className="display mt-3 max-w-5xl text-[clamp(2rem,4.4vw,3.6rem)]">{active ? "Your agent is shopping under these rules." : "This mandate is revoked."}</h1>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[0.9rem] font-medium ${active ? "bg-mint text-go" : "bg-ink text-paper"}`}>
          {active ? "Mandate active" : "Revoked: every request is denied"}
        </span>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-8">
          <Card label="Shopping day" title="Send the agent shopping">
            <p className="mb-5 leading-relaxed text-ink-2">
              Tell Claude what you need. Every payment it tries goes through your rules first, as a real PayPal sandbox hold.
            </p>
            <AgentRun example={DEMO_GOAL} attempt={randomUUID()} />
          </Card>

          <Card label="Test the rules" title="Or send one cart yourself">
            <p className="mb-5 leading-relaxed text-ink-2">
              Each button sends a fixed cart, as if the agent had proposed it. The last one is what an agent tricked by a listing would send.
            </p>
            <Simulator disabled={!active} attempt={randomUUID()} scenarios={scenarios} />
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
              <p className="text-ink-2">Nothing yet. Send the agent shopping above.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {shopLabel(policy, p.payeeMerchantId)} · {formatCents(p.totalCents)}
                        <span className="text-ink-2"> · {decisionLabel(p.decision)}</span>
                        {p.source === "mcp" && <span className="ml-2 rounded-full border border-line-strong px-2 py-0.5 align-middle text-[0.75rem] text-ink-2">your agent</span>}
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

        <div className="space-y-4 lg:col-span-4">
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
        </div>
      </div>

      <Card label="Developers" title="Connect your own agent" className="mt-4">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="leading-relaxed text-ink-2">
              The agent above runs inside Chaperone. Chaperone is also an MCP server, so your own agent can shop and pay the same way: Claude Code, Cursor, or an
              agent you built. Its key is tied to this mandate, so it can&apos;t pick a looser one, and it never sees your PayPal details.
            </p>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {TOOLS.map(([name, what]) => (
                <div key={name} className="py-3">
                  <dt className="font-mono text-[0.85rem]">{name}</dt>
                  <dd className="mt-1 text-[0.92rem] leading-relaxed text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="label mt-8 text-ink-2">In your own product</p>
            <ol className="mt-3 space-y-2 text-[0.95rem] leading-relaxed text-ink-2">
              <li>1. Your user writes and signs a mandate, and links PayPal once.</li>
              <li>2. They create a key for that mandate and give it to your agent.</li>
              <li>3. Your agent finds products however it likes, then calls request_payment. Chaperone checks the cart and places, captures or voids the PayPal hold.</li>
            </ol>
          </div>
          <div className="lg:col-span-7">
            <AgentKey disabled={!active} />
          </div>
        </div>
      </Card>
    </div>
  );
}
