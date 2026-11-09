import { createHmac } from "node:crypto";
import { SignJWT, UnsecuredJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "session-test-secret-0123456789abcdefghij";
process.env.APPROVAL_LINK_SECRET = SECRET;

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

const { clearSession, sessionUserId, setSession } = await import("@/lib/app/session");
const sessionKey = createHmac("sha256", SECRET).update("chaperone-session-v1").digest();
const forge = (token: string) => jar.set("chp_session", token);

beforeEach(() => jar.clear());

describe("demo session cookie", () => {
  it("round-trips the user id and clears", async () => {
    await setSession("user-1");
    expect(await sessionUserId()).toBe("user-1");
    await clearSession();
    expect(await sessionUserId()).toBeNull();
  });

  it("refuses a token for another audience, even with the right key", async () => {
    forge(await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setAudience("chaperone:approval").setExpirationTime("1h").sign(sessionKey));
    expect(await sessionUserId()).toBeNull();
  });

  it("refuses an unsigned token and one signed with the approval-link secret itself", async () => {
    forge(new UnsecuredJWT({ sub: "user-1", aud: "chaperone:session" }).encode());
    expect(await sessionUserId()).toBeNull();
    forge(await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setAudience("chaperone:session").setExpirationTime("1h").sign(new TextEncoder().encode(SECRET)));
    expect(await sessionUserId()).toBeNull();
  });

  it("refuses an expired or tampered token", async () => {
    forge(await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setAudience("chaperone:session").setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(sessionKey));
    expect(await sessionUserId()).toBeNull();
    await setSession("user-1");
    const [h, p, s] = jar.get("chp_session")!.split(".");
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), sub: "user-2" })).toString("base64url");
    forge(`${h}.${other}.${s}`);
    expect(await sessionUserId()).toBeNull();
  });
});
