// A separate Claude agent that pays only through a Chaperone MCP endpoint, as a third-party developer's agent would.
// pnpm tsx scripts/second-agent.ts [mcp url] ["goal"]   (key from CHAPERONE_AGENT_KEY or docs/private/agent-key.txt)
// Claude calls are metered against LLM_BUDGET_USD in DATABASE_URL like every other call.
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { Channel3 } from "@channel3/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDb } from "@/db/client";
import { channel3Search } from "@/lib/agent/catalog";
import { runMcpAgent } from "@/lib/agent/mcp-agent";
import { createLlm } from "@/lib/llm/llm";
import { liveTransport } from "@/lib/llm/transport";

process.loadEnvFile(".env.local");
const url = new URL(process.argv[2] ?? "https://www.chaperone.site/api/mcp");
const goal = process.argv[3] ?? "Restock: a large bag of dry dog food and a bottle of dish soap.";
const key = (process.env.CHAPERONE_AGENT_KEY ?? readFileSync("docs/private/agent-key.txt", "utf8")).trim();

const { db, pool } = createDb(process.env.DATABASE_URL!, { max: 2 });
const llm = createLlm({ db, transport: liveTransport(new Anthropic()), budgetUsd: Number(process.env.LLM_BUDGET_USD ?? "1.5") });
const mcp = new Client({ name: "second-agent", version: "0.1.0" });
try {
  await mcp.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  // Channel3 is only used if the server has no search_products of its own (the deployed one does).
  const search = process.env.CHANNEL3_API_KEY ? channel3Search(new Channel3({ apiKey: process.env.CHANNEL3_API_KEY })) : undefined;
  const run = await runMcpAgent({ llm, mcp, search }, { goal });
  for (const s of run.steps) console.log(`\n> ${s.tool} ${JSON.stringify(s.input)}\n${s.output.slice(0, 600)}`);
  console.log(`\n${run.summary}\n\n(${run.turns} turns, ${run.stopped}; total metered spend $${((await llm.spentMicroUsd()) / 1e6).toFixed(6)} of $${(llm.capMicroUsd / 1e6).toFixed(2)})`);
} finally {
  await mcp.close();
  await pool.end();
}
