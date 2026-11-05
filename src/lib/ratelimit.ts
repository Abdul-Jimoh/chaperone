import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rateLimits } from "@/db/schema";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `message` is shown to the visitor or agent; it is completed with when to try again. */
export type Limit = { name: string; max: number; windowMs: number; message: string };

/**
 * The public demo spends nothing real, but every visitor shares one sandbox wallet and one database,
 * so one script mustn't be able to fill either. Per-visitor limits stop a single abuser; the global
 * ones cap what everyone together can do in a day.
 */
export const LIMITS = {
  demoStartPerClient: { name: "demo-start:client", max: 10, windowMs: HOUR, message: "You've started several demos from here in the last hour." },
  demoStartAll: { name: "demo-start", max: 400, windowMs: DAY, message: "The demo has had a lot of visitors today." },
  purchasesPerShopper: { name: "purchases:shopper", max: 30, windowMs: HOUR, message: "That's a lot of purchases for one hour." },
  purchasesAll: { name: "purchases", max: 2_000, windowMs: DAY, message: "The shared sandbox wallet has reached today's purchase limit." },
  approvalLinksPerShopper: { name: "approval-links:shopper", max: 40, windowMs: HOUR, message: "That's a lot of approval links for one hour." },
  agentKeysPerShopper: { name: "agent-keys:shopper", max: 5, windowMs: DAY, message: "You've created several agent keys today." },
  mcpCallsPerKey: { name: "mcp:key", max: 150, windowMs: HOUR, message: "This agent key has made a lot of calls this hour." },
} satisfies Record<string, Limit>;

export type Verdict = { ok: true } | { ok: false; limit: Limit; retryAfterSec: number };

/** Counts one hit against each limit and refuses if any is over. Atomic per bucket, so parallel requests can't slip past. */
export async function hit(db: Db, checks: [Limit, string | null][], now = new Date()): Promise<Verdict> {
  for (const [limit, subject] of checks) {
    const start = Math.floor(now.getTime() / limit.windowMs) * limit.windowMs;
    const bucket = subject === null ? limit.name : `${limit.name}:${subject}`;
    const [row] = await db
      .insert(rateLimits)
      .values({ bucket, windowStart: new Date(start), hits: 1 })
      .onConflictDoUpdate({ target: [rateLimits.bucket, rateLimits.windowStart], set: { hits: sql`${rateLimits.hits} + 1` } })
      .returning({ hits: rateLimits.hits });
    if (row!.hits > limit.max) {
      return { ok: false, limit, retryAfterSec: Math.ceil((start + limit.windowMs - now.getTime()) / 1000) };
    }
  }
  return { ok: true };
}

function waitText(retryAfterSec: number): string {
  if (retryAfterSec < 90) return "in a minute";
  if (retryAfterSec < 90 * 60) return `in about ${Math.round(retryAfterSec / 60)} minutes`;
  return `in about ${Math.round(retryAfterSec / 3600)} hours`;
}

export function refusal(verdict: Extract<Verdict, { ok: false }>): string {
  return `${verdict.limit.message} Please try again ${waitText(verdict.retryAfterSec)}.`;
}

/** Visitors are counted by a keyed hash of their address, so raw IPs are never stored. */
export function clientId(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(`client:${ip}`).digest("base64url").slice(0, 22);
}

export async function pruneRateLimits(db: Db, now = new Date()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * DAY)));
}
