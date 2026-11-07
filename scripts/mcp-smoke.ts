// Talks to a running Chaperone MCP endpoint as a separate client would.
// pnpm tsx scripts/mcp-smoke.ts [url] [pay]   (default url http://localhost:3000/api/mcp; "pay" buys a $7.50 dish soap from Home Basics by listing id)
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.loadEnvFile(".env.local");
const url = new URL(process.argv[2] ?? "http://localhost:3000/api/mcp");
const key = (process.env.CHAPERONE_AGENT_KEY ?? readFileSync("docs/private/agent-key.txt", "utf8")).trim();

const client = new Client({ name: "chaperone-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));

const show = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  console.log(`\n# ${name}\n${(result.content as { text: string }[])[0]!.text}`);
};

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
await show("check_mandate");
if (process.argv[3] === "pay") {
  await show("search_products", { query: "dish soap" });
  await show("request_payment", { items: [{ listing_id: "hb-dish-soap-750", quantity: 1 }] });
  await show("list_spend", { limit: 5 });
}
await client.close();
