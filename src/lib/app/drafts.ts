import { createHmac, timingSafeEqual } from "node:crypto";
import { policySchema, type Policy } from "@/lib/policy/schema";

/** What the user was shown and is confirming: their sentence and the exact policy read back to them. */
export type Draft = { userId: string; statement: string; policy: Policy; expiresAt: number };

const TTL_MS = 60 * 60_000;

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(`mandate-draft:${payload}`).digest();
}

/**
 * The read-back travels to the browser sealed, and confirming hands the seal back. Signing then uses exactly the
 * policy the user read, and nothing the browser (or an LLM) changed after the read-back can become a mandate.
 */
export function sealDraft(secret: string, draft: Omit<Draft, "expiresAt">, now = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ ...draft, expiresAt: now.getTime() + TTL_MS })).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

export function openDraft(secret: string, token: string, userId: string, now = new Date()): Draft | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = mac(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let draft: Draft;
  try {
    draft = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (draft.userId !== userId || draft.expiresAt < now.getTime() || typeof draft.statement !== "string") return null;
  const policy = policySchema.safeParse(draft.policy);
  return policy.success ? { ...draft, policy: policy.data } : null;
}
