import { requireEnv } from "@/lib/env";
import { registerClient } from "@/lib/oauth";
import { json, preflight } from "@/lib/oauth-http";
import { hit, LIMITS } from "@/lib/ratelimit";
import { serverDb, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7591 dynamic client registration. Nothing is stored: the client id is signed and carries its redirect URIs. */
export const POST = withConfigCheck(async (request) => {
  if (!(await hit(serverDb(), [[LIMITS.oauthRegistrationsAll, null]])).ok) {
    return json({ error: "temporarily_unavailable", error_description: LIMITS.oauthRegistrationsAll.message }, 429);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const result = registerClient(requireEnv("APPROVAL_LINK_SECRET"), body ?? {});
  if ("error" in result) return json({ error: "invalid_redirect_uri", error_description: result.error }, 400);
  return json(
    {
      client_id: result.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: result.client.name,
      redirect_uris: result.client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
});

export const OPTIONS = preflight;
