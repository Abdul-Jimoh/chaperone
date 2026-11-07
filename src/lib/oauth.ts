import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { oauthCodes } from "@/db/schema";
import { sha256Hex } from "@/lib/policy/canonical";
import { issueAgentKey } from "@/mcp/keys";

/**
 * "Connect Chaperone": OAuth 2.1 for the MCP endpoint, as the MCP authorization spec describes. A client registers
 * itself, the signed-in user picks it up on a consent page, and the token it gets back is an agent key bound to
 * that user's mandate. The agent never sees a key the user had to copy, and the user can disconnect it.
 */
export type Client = { name: string; redirectUris: string[] };

const CODE_TTL_MS = 5 * 60_000;
const CLIENT_PREFIX = "chp_cl_";

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(`oauth-client:${payload}`).digest();
}

/** Loopback for native apps like Claude Code (any port), https for everything else. */
export function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Dynamic client registration without a table: the client id carries its own redirect URIs, signed. */
export function registerClient(secret: string, input: { client_name?: unknown; redirect_uris?: unknown }): { clientId: string; client: Client } | { error: string } {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every((u) => typeof u === "string" && u.length <= 500 && allowedRedirect(u))) {
    return { error: "redirect_uris must be 1 to 5 https URLs, or http URLs on localhost." };
  }
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 60) : "An MCP client";
  const client: Client = { name, redirectUris: uris as string[] };
  const payload = Buffer.from(JSON.stringify(client)).toString("base64url");
  return { clientId: `${CLIENT_PREFIX}${payload}.${mac(secret, payload).toString("base64url")}`, client };
}

export function readClient(secret: string, clientId: string): Client | null {
  if (!clientId.startsWith(CLIENT_PREFIX)) return null;
  const [payload, signature] = clientId.slice(CLIENT_PREFIX.length).split(".");
  if (!payload || !signature) return null;
  const expected = mac(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const client = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Client;
    return typeof client.name === "string" && Array.isArray(client.redirectUris) ? client : null;
  } catch {
    return null;
  }
}

export type AuthorizeRequest = { clientId: string; client: Client; redirectUri: string; codeChallenge: string; state: string | null };

/**
 * Checks an authorization request. Errors before the redirect URI is known to be the client's are shown on the page
 * (never redirected), as OAuth requires; later errors go back to the client.
 */
export function checkAuthorize(
  secret: string,
  resource: string,
  params: Record<string, string | undefined>,
): { ok: true; request: AuthorizeRequest } | { ok: false; show: string } | { ok: false; redirect: string } {
  const client = params.client_id ? readClient(secret, params.client_id) : null;
  if (!client) return { ok: false, show: "This connection request came from an app Chaperone doesn't recognise. Start again from your agent." };
  const redirectUri = params.redirect_uri ?? "";
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, show: "This connection request has a return address the app didn't register." };
  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (params.state) url.searchParams.set("state", params.state);
    return { ok: false as const, redirect: url.toString() };
  };
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required.");
  if (params.resource && !sameResource(params.resource, resource)) return back("invalid_target", "This server only issues tokens for its MCP endpoint.");
  return { ok: true, request: { clientId: params.client_id!, client, redirectUri, codeChallenge: params.code_challenge, state: params.state ?? null } };
}

export function sameResource(given: string, resource: string): boolean {
  return given.replace(/\/+$/, "") === resource.replace(/\/+$/, "");
}

export async function issueCode(db: Db, request: AuthorizeRequest, mandateId: string, now = new Date()): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(oauthCodes).values({
    codeHash: sha256Hex(code),
    clientId: request.clientId,
    clientName: request.client.name,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    mandateId,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return code;
}

export function approvedRedirect(request: AuthorizeRequest, code: string): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}

/** Trades a code for an access token. A code works once, within five minutes, for the client and verifier it was issued to. */
export async function redeemCode(
  db: Db,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
  now = new Date(),
): Promise<{ accessToken: string } | { error: string }> {
  // Burned before it is checked, so a code can't be tried twice, even with a different verifier.
  const [row] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.codeHash, sha256Hex(input.code)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, now)))
    .returning();
  if (!row) return { error: "The code is unknown, used or expired." };
  const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri || challenge !== row.codeChallenge) {
    return { error: "The code was issued for a different client, return address or verifier." };
  }
  return { accessToken: await issueAgentKey(db, row.mandateId, row.clientName, "oauth") };
}
