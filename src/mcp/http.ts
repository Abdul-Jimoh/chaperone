import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { PaymentDeps } from "@/lib/payments/service";
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

  const server = createMcpServer(deps, agent.mandateId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
