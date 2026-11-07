import { endpoints, json, preflight } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";

/** RFC 8414 metadata. Public clients only, PKCE (S256) required, clients register themselves (RFC 7591). */
export async function GET() {
  const { origin } = await endpoints();
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["payments"],
  });
}

export const OPTIONS = preflight;
