import type { Metadata } from "next";
import { ConnectAgent } from "@/components/app/AgentKey";
import { PageHeader, Section } from "@/components/app/ui";
import { appOrigin } from "@/lib/app/origin";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an agent" };

const TOOLS = [
  ["check_mandate", "Reads the rules, the shops and what's left to spend. Can preview a cart without reserving anything."],
  ["search_products", "Searches the shops' catalog. Prices and sellers come from Chaperone, not from the agent."],
  ["request_payment", "Asks to pay one shop for a cart. Returns paid, waiting for you, or blocked, and the rule that decided."],
  ["list_spend", "Lists what it has bought and the budget windows."],
  ["revoke_mandate", "Stops itself for good."],
] as const;

export default async function ConnectPage() {
  const data = await requireData();

  return (
    <div className="space-y-12">
      <PageHeader label="Developers" title="Connect your own agent.">
        The agent on the Shop page runs inside Chaperone. Chaperone is also an MCP server, so Claude Code, Cursor or an agent you built can shop and pay the same way. It signs in
        as you, is tied to these rules, and never sees your PayPal details.
      </PageHeader>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ConnectAgent
          endpoint={`${await appOrigin()}/api/mcp`}
          disabled={data.mandate.status !== "active"}
          agents={data.agents.map((a) => ({ id: a.id, label: a.label, via: a.via, lastUsedAt: a.lastUsedAt?.toISOString() ?? null }))}
        />

        <div className="space-y-12">
          <Section label="Five tools" title="What the agent gets">
            <dl className="divide-y divide-line border-y border-line">
              {TOOLS.map(([name, what]) => (
                <div key={name} className="py-3">
                  <dt className="font-mono text-[0.85rem]">{name}</dt>
                  <dd className="mt-1 text-[0.92rem] leading-relaxed text-ink-2">{what}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section label="In your own product" title="Three steps">
            <ol className="space-y-2 text-[0.95rem] leading-relaxed text-ink-2">
              <li>1. Your user writes and signs a mandate, and links PayPal once.</li>
              <li>2. Your agent asks to connect; they sign in to Chaperone and press Allow. No card or key changes hands.</li>
              <li>3. Your agent shops and calls request_payment. Chaperone checks the cart and places, captures or voids the PayPal hold.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
