import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { PaymentDeps } from "@/lib/payments/service";
import { hit, LIMITS, refusal } from "@/lib/ratelimit";
import { resolveAgentKey } from "./keys";
import { createMcpServer } from "./server";

function unauthorized(message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="chaperone"' } },
  );
}

/**
 * Stateless Streamable HTTP: each request gets a fresh server bound to the mandate behind its bearer
 * key, so nothing is kept between serverless invocations.
 */
export async function handleMcpRequest(request: Request, deps: PaymentDeps): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return unauthorized("Send an agent key as a Bearer token.");
  const agent = await resolveAgentKey(deps.db, key, deps.clock?.());
  if (!agent) return unauthorized("Unknown or revoked agent key.");
  const verdict = await hit(deps.db, [[LIMITS.mcpCallsPerKey, agent.keyId]], deps.clock?.());
  if (!verdict.ok) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32029, message: refusal(verdict) }, id: null },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSec) } },
    );
  }

  // The limit counts requests, so a JSON-RPC batch would let one request carry a hundred calls.
  // Batching was dropped from MCP in 2025-06-18; refuse it rather than count inside it.
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.trimStart().startsWith("[")) {
      return Response.json({ jsonrpc: "2.0", error: { code: -32600, message: "Batched requests aren't supported; send one call per request." }, id: null }, { status: 400 });
    }
    request = new Request(request, { body });
  }

  const server = createMcpServer(deps, agent.mandateId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
