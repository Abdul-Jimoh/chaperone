import { endpoints, json, preflight } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";

/** RFC 9728: tells an MCP client which authorization server issues tokens for /api/mcp. */
export async function GET() {
  const { origin, resource } = await endpoints();
  return json({ resource, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Chaperone" });
}

export const OPTIONS = preflight;
