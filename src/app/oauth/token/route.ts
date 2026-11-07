import { requireEnv } from "@/lib/env";
import { readClient, redeemCode, sameResource } from "@/lib/oauth";
import { endpoints, json, preflight } from "@/lib/oauth-http";
import { serverDb, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, description: string) => json({ error, error_description: description }, 400);

/** Authorization code + PKCE for an access token: an agent key bound to the mandate the user picked. */
export const POST = withConfigCheck(async (request) => {
  const form = new URLSearchParams(await request.text());
  const get = (name: string) => form.get(name) ?? "";
  if (get("grant_type") !== "authorization_code") return fail("unsupported_grant_type", "Only authorization_code is supported.");
  if (!readClient(requireEnv("APPROVAL_LINK_SECRET"), get("client_id"))) return fail("invalid_client", "Unknown client.");
  const { resource } = await endpoints();
  if (form.get("resource") && !sameResource(get("resource"), resource)) return fail("invalid_target", "Tokens are only issued for this server's MCP endpoint.");
  if (!get("code") || !get("code_verifier")) return fail("invalid_request", "code and code_verifier are required.");
  const result = await redeemCode(serverDb(), { code: get("code"), clientId: get("client_id"), redirectUri: get("redirect_uri"), codeVerifier: get("code_verifier") });
  if ("error" in result) return fail("invalid_grant", result.error);
  return json({ access_token: result.accessToken, token_type: "Bearer", scope: "payments" });
});

export const OPTIONS = preflight;
