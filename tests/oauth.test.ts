import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agentKeys, oauthCodes } from "@/db/schema";
import { disconnectAgent, NotYoursError } from "@/lib/app/demo";
import { approvedRedirect, checkAuthorize, issueCode, readClient, redeemCode, registerClient } from "@/lib/oauth";
import type { PaymentDeps } from "@/lib/payments/service";
import { handleMcpRequest } from "@/mcp/http";
import { resolveAgentKey } from "@/mcp/keys";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(10);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SECRET = "test-oauth-secret";
const RESOURCE = "https://chaperone.test/api/mcp";
const CALLBACK = "http://localhost:53682/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function register(redirectUris: string[] = [CALLBACK]) {
  const result = registerClient(SECRET, { client_name: "Claude Code", redirect_uris: redirectUris });
  if ("error" in result) throw new Error(result.error);
  return result.clientId;
}

function authorizeParams(clientId: string, challenge: string, overrides: Record<string, string | undefined> = {}) {
  return { client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: RESOURCE, ...overrides };
}

/** The whole "Connect Chaperone" flow, as an MCP client and the signed-in user would go through it. */
async function connect(mandateId: string) {
  const clientId = register();
  const { verifier, challenge } = pkce();
  const check = checkAuthorize(SECRET, RESOURCE, authorizeParams(clientId, challenge));
  if (!check.ok) throw new Error("authorize rejected");
  const code = new URL(approvedRedirect(check.request, await issueCode(db, check.request, mandateId))).searchParams.get("code")!;
  return { clientId, verifier, code };
}

describe("client registration", () => {
  it("accepts loopback and https return addresses only, and signs the client id", () => {
    expect(registerClient(SECRET, { redirect_uris: ["http://evil.example/callback"] })).toHaveProperty("error");
    expect(registerClient(SECRET, { redirect_uris: [] })).toHaveProperty("error");
    expect(registerClient(SECRET, { redirect_uris: ["https://app.example/cb", "http://127.0.0.1:9000/cb"] })).toHaveProperty("clientId");
    const clientId = register();
    expect(readClient(SECRET, clientId)).toEqual({ name: "Claude Code", redirectUris: [CALLBACK] });
    expect(readClient("another-secret", clientId)).toBeNull();
    const forged = clientId.replace(/^chp_cl_[^.]+/, `chp_cl_${Buffer.from(JSON.stringify({ name: "x", redirectUris: ["https://evil.example"] })).toString("base64url")}`);
    expect(readClient(SECRET, forged)).toBeNull();
  });
});

describe("authorization requests", () => {
  it("shows, never redirects, errors before the return address is trusted", () => {
    const { challenge } = pkce();
    expect(checkAuthorize(SECRET, RESOURCE, authorizeParams("chp_cl_bogus.sig", challenge))).toHaveProperty("show");
    expect(checkAuthorize(SECRET, RESOURCE, authorizeParams(register(), challenge, { redirect_uri: "http://localhost:1/other" }))).toHaveProperty("show");
  });

  it("requires PKCE S256, response_type=code and this server's resource, and never redirects on error", () => {
    const clientId = register(["https://evil.example/"]);
    const { challenge } = pkce();
    const check = (overrides: Record<string, string | undefined>) =>
      checkAuthorize(SECRET, RESOURCE, { ...authorizeParams(clientId, challenge, overrides), redirect_uri: "https://evil.example/" });
    for (const overrides of [{ response_type: "token" }, { code_challenge_method: "plain" }, { code_challenge: undefined }, { resource: "https://other.example/mcp" }]) {
      const result = check(overrides);
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty("show");
      expect(result).not.toHaveProperty("redirect");
    }
    expect(check({}).ok).toBe(true);
  });
});

describe("codes and tokens", () => {
  it("trades a code once for a key bound to the mandate the user allowed", async () => {
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { clientId, verifier, code } = await connect(mandate.id);
    const first = await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier });
    if ("error" in first) throw new Error(first.error);
    expect(await resolveAgentKey(db, first.accessToken)).toMatchObject({ mandateId: mandate.id });
    const [key] = await db.select().from(agentKeys);
    expect(key).toMatchObject({ label: "Claude Code", via: "oauth" });

    expect(await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier })).toHaveProperty("error");
  });

  it("refuses the wrong verifier, client or return address, and burns the code", async () => {
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { clientId, verifier, code } = await connect(mandate.id);
    expect(await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: pkce().verifier })).toHaveProperty("error");
    expect(await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier })).toHaveProperty("error");

    const second = await connect(mandate.id);
    expect(await redeemCode(db, { ...second, redirectUri: "http://localhost:1/x", codeVerifier: second.verifier })).toHaveProperty("error");
    const third = await connect(mandate.id);
    expect(await redeemCode(db, { ...third, clientId: register(["http://localhost:2/cb"]), redirectUri: CALLBACK, codeVerifier: third.verifier })).toHaveProperty("error");
    expect(await db.select().from(agentKeys)).toEqual([]);
  });

  it("refuses a code after five minutes", async () => {
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { clientId, verifier, code } = await connect(mandate.id);
    const later = new Date(Date.now() + 6 * 60_000);
    expect(await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier }, later)).toHaveProperty("error");
    expect((await db.select().from(oauthCodes))[0]!.usedAt).toBeNull();
  });
});

describe("the MCP endpoint with a signed-in agent", () => {
  it("points an unauthenticated client at the sign-in", async () => {
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
    const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees };
    const response = await handleMcpRequest(new Request(RESOURCE, { method: "POST", body: "{}" }), deps, {
      resourceMetadata: "https://chaperone.test/.well-known/oauth-protected-resource/api/mcp",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="https://chaperone.test/.well-known/oauth-protected-resource/api/mcp"');
  });

  it("works with the token, and stops the moment the user disconnects it", async () => {
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
    const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees };
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const { clientId, verifier, code } = await connect(mandate.id);
    const token = await redeemCode(db, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier });
    if ("error" in token) throw new Error(token.error);

    const client = new Client({ name: "claude-code", version: "1.0.0" });
    const handler: typeof fetch = async (input, init) => handleMcpRequest(new Request(input, init), deps);
    await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { fetch: handler, requestInit: { headers: { Authorization: `Bearer ${token.accessToken}` } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("request_payment");
    await client.close();

    const [key] = await db.select().from(agentKeys);
    const other = await seedLinkedMandate(db, samplePolicy());
    await expect(disconnectAgent(db, other.userId, key!.id)).rejects.toBeInstanceOf(NotYoursError);
    await disconnectAgent(db, mandate.userId, key!.id);
    expect(await resolveAgentKey(db, token.accessToken)).toBeNull();
  });
});
