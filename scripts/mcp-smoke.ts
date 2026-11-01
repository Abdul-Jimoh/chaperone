// Talks to a running Chaperone MCP endpoint as a separate client would.
// pnpm tsx scripts/mcp-smoke.ts [url] [pay]   (default url http://localhost:3000/api/mcp; "pay" buys $18 of coffee from Shop A)
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
  await show("request_payment", {
    payee_merchant_id: process.env.PAYPAL_SHOP_A_MERCHANT_ID,
    items: [{ product_id: "smoke-beans-1kg", title: "Whole bean coffee, 1 kg", unit_price_cents: 1800, quantity: 1, category: "coffee" }],
  });
  await show("list_spend", { limit: 5 });
}
await client.close();
