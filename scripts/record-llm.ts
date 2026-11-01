// Records real Claude responses as test fixtures: pnpm tsx scripts/record-llm.ts compile|agent
// Each run is metered against LLM_BUDGET_USD in the database, like any other call.
// "agent" also records live Channel3 results; its payments go to a throwaway local Postgres and a fake PayPal.
import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@/db/client";
import { createLlm } from "@/lib/llm/llm";
import { recordingTransport } from "@/lib/llm/transport";
import { Channel3 } from "@channel3/sdk";
import { mandates, paymentMethods, users } from "@/db/schema";
import { channel3Search, recordingSearch } from "@/lib/agent/catalog";
import { runShoppingAgent } from "@/lib/agent/run";
import { compileMandate } from "@/lib/policy/compile";
import { startEmbeddedPostgres } from "../tests/support/embedded-pg";
import { fakePayPal } from "../tests/support/fake-paypal";
import {
  CHANNEL3_FIXTURE_DIR,
  DEMO_AGENT_GOAL,
  DEMO_AGENT_SHOPS,
  DEMO_POLICY,
  DEMO_SHOPS,
  DEMO_STATEMENT,
  DEMO_TIMEZONE,
  FIXTURE_DIR,
} from "../tests/support/llm-fixtures";

process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is needed so the call is metered against the budget.");

const { db, pool } = createDb(url, { max: 2 });
const llm = createLlm({
  db,
  transport: recordingTransport(new Anthropic(), FIXTURE_DIR),
  budgetUsd: Number(process.env.LLM_BUDGET_USD ?? "1.5"),
});

try {
  switch (process.argv[2]) {
    case "compile": {
      const result = await compileMandate(llm, { statement: DEMO_STATEMENT, shops: DEMO_SHOPS, timezone: DEMO_TIMEZONE });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "agent": {
      const local = await startEmbeddedPostgres();
      const payments = createDb(local.url, { max: 3 });
      try {
        const [user] = await payments.db.insert(users).values({ displayName: "Recording" }).returning();
        await payments.db.insert(paymentMethods).values({ userId: user!.id, paypalPaymentTokenId: "VAULT-TEST-1" });
        const [mandate] = await payments.db
          .insert(mandates)
          .values({ userId: user!.id, statement: DEMO_STATEMENT, policy: DEMO_POLICY, hash: "recording", jws: "recording", issuedAt: new Date() })
          .returning();
        const paypal = fakePayPal(Object.fromEntries(DEMO_SHOPS.map((s) => [`${s.key}-app`, s.merchantId])));
        const result = await runShoppingAgent(
          {
            llm,
            search: recordingSearch(channel3Search(new Channel3({ apiKey: process.env.CHANNEL3_API_KEY! })), CHANNEL3_FIXTURE_DIR),
            payments: { db: payments.db, platform: paypal.platform, payees: paypal.payees },
            shops: DEMO_AGENT_SHOPS,
          },
          { mandateId: mandate!.id, goal: DEMO_AGENT_GOAL, runId: "run-recorded-1" },
        );
        console.log(JSON.stringify(result, null, 2));
      } finally {
        await payments.pool.end();
        await local.stop();
      }
      break;
    }
    default:
      console.log("usage: record-llm.ts compile|agent");
  }
  console.log(`\nTotal metered spend: $${((await llm.spentMicroUsd()) / 1e6).toFixed(6)} of $${(llm.capMicroUsd / 1e6).toFixed(2)}`);
} finally {
  await pool.end();
}
