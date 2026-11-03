import "server-only";
import { createHmac } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

const COOKIE = "chp_session";
const AUDIENCE = "chaperone:session";
const MAX_AGE_S = 7 * 24 * 60 * 60;

// Derived from the approval-link secret with a distinct label, so a session token can never pass as an approval link.
function key(): Uint8Array {
  return createHmac("sha256", requireEnv("APPROVAL_LINK_SECRET")).update("chaperone-session-v1").digest();
}

export async function setSession(userId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** The signed-in user's id, or null. A tampered or expired cookie is treated as no session. */
export async function sessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: AUDIENCE, algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
