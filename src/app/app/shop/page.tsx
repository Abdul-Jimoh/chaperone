import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { AgentRun } from "@/components/app/AgentRun";
import { Simulator } from "@/components/app/Simulator";
import { Card, PageHeader } from "@/components/app/ui";
import { scenarioCards } from "@/lib/app/demo";
import { DEMO_GOAL } from "@/lib/demo";
import { demoWorld } from "@/lib/server";
import { requireData } from "../data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop" };

export default async function ShopPage() {
  const data = await requireData();
  const active = data.mandate.status === "active";
  const shops = data.mandate.policy.merchants.map((m) => m.name).join(", ");

  return (
    <div className="space-y-10">
      <PageHeader label="Shop" title="Send the agent shopping.">
        Tell Claude what you need. It searches {shops}, and every payment it tries goes through your rules first, as a real PayPal sandbox hold.
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <Card label="Claude, live" title="Your shopping list">
          <AgentRun example={DEMO_GOAL} attempt={randomUUID()} />
        </Card>

        <section id="test" className="scroll-mt-28 rounded-[1.4rem] bg-paper-2 p-5 sm:p-6">
          <p className="label text-ink-2">Test the rules</p>
          <h2 className="mt-1.5 text-[1.2rem] font-semibold tracking-tight">Or send one cart yourself</h2>
          <p className="mt-2 mb-5 text-[0.95rem] leading-relaxed text-ink-2">
            Each sends a fixed cart, as if the agent had proposed it. The last is what an agent tricked by a listing would send.
          </p>
          <Simulator disabled={!active} attempt={randomUUID()} scenarios={scenarioCards(demoWorld(), data.mandate, data.spent)} stacked />
        </section>
      </div>
    </div>
  );
}
