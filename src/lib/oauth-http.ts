import { appOrigin } from "@/lib/app/origin";

// Public, cookie-free endpoints: browser-based MCP clients (like the MCP Inspector) may call them from any origin.
export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, mcp-protocol-version", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
}

export async function endpoints() {
  const origin = await appOrigin();
  return {
    origin,
    resource: `${origin}/api/mcp`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  };
}
