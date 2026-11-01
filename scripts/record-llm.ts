// Records real Claude responses as test fixtures: pnpm tsx scripts/record-llm.ts compile
// Each run is metered against LLM_BUDGET_USD in the database, like any other call.
import Anthropic from "@anthropic-ai/sdk";
import { createDb } from "@/db/client";
import { createLlm } from "@/lib/llm/llm";
import { recordingTransport } from "@/lib/llm/transport";
import { compileMandate } from "@/lib/policy/compile";
import { DEMO_SHOPS, DEMO_STATEMENT, DEMO_TIMEZONE, FIXTURE_DIR } from "../tests/support/llm-fixtures";

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
    default:
      console.log("usage: record-llm.ts compile");
  }
  console.log(`\nTotal metered spend: $${((await llm.spentMicroUsd()) / 1e6).toFixed(6)} of $${(llm.capMicroUsd / 1e6).toFixed(2)}`);
} finally {
  await pool.end();
}
