import { createHmac } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rateLimits, users } from "@/db/schema";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `message` is shown to the visitor or agent; it is completed with when to try again. */
export type Limit = { name: string; max: number; windowMs: number; message: string };

/**
 * The public demo spends nothing real, but every visitor shares one sandbox wallet and one database,
 * so one script mustn't be able to fill either. The per-visitor limits do the work: a visitor gets at most
 * 20 shoppers and 300 purchases a day across all of them, however the purchases are made and however old the
 * shoppers are. The global caps sit far above that, so a single abuser can't use them up and lock others out.
 */
export const LIMITS = {
  demoStartPerClient: { name: "demo-start:client", max: 10, windowMs: HOUR, message: "You've started several demos from here in the last hour." },
  demoStartPerClientDaily: { name: "demo-start:client-day", max: 20, windowMs: DAY, message: "You've started a lot of demos from here today." },
  demoStartAll: { name: "demo-start", max: 3_000, windowMs: DAY, message: "The demo has had a lot of visitors today." },
  mandatesPerShopper: { name: "mandates:shopper", max: 10, windowMs: DAY, message: "You've signed a lot of mandates today." },
  purchasesPerShopper: { name: "purchases:shopper", max: 30, windowMs: HOUR, message: "That's a lot of purchases for one hour." },
  purchasesPerShopperDaily: { name: "purchases:shopper-day", max: 60, windowMs: DAY, message: "That's a lot of purchases for one day." },
  purchasesPerClientDaily: { name: "purchases:client-day", max: 300, windowMs: DAY, message: "That's a lot of purchases from here for one day." },
  purchasesAll: { name: "purchases", max: 10_000, windowMs: DAY, message: "The shared sandbox wallet has reached today's purchase limit." },
  approvalLinksPerShopper: { name: "approval-links:shopper", max: 40, windowMs: HOUR, message: "That's a lot of approval links for one hour." },
  agentKeysPerShopper: { name: "agent-keys:shopper", max: 5, windowMs: DAY, message: "You've created several agent keys today." },
  // Not shown to anyone: a full bucket just means the page skips the sweep this minute.
  pageSweep: { name: "sweep:page", max: 1, windowMs: 60_000, message: "" },
  mcpCallsPerKey: { name: "mcp:key", max: 150, windowMs: HOUR, message: "This agent key has made a lot of calls this hour." },
} satisfies Record<string, Limit>;

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number, message: string) {
    super(message);
  }
}

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

/**
 * Keyed by the shopper, not the mandate or the channel, so the simulator and MCP agents draw on one allowance;
 * and by the visitor who started the shopper, so keeping old shoppers or agent keys around doesn't add allowance.
 */
export async function purchaseChecks(db: Db, userId: string): Promise<[Limit, string | null][]> {
  const [user] = await db.select({ client: users.demoClient }).from(users).where(eq(users.id, userId));
  return [
    [LIMITS.purchasesPerShopper, userId],
    [LIMITS.purchasesPerShopperDaily, userId],
    ...(user?.client ? [[LIMITS.purchasesPerClientDaily, user.client] as [Limit, string]] : []),
    [LIMITS.purchasesAll, null],
  ];
}

export async function enforce(db: Db, checks: [Limit, string | null][], now = new Date()): Promise<void> {
  const verdict = await hit(db, checks, now);
  if (!verdict.ok) throw new RateLimitedError(verdict.retryAfterSec, refusal(verdict));
}

/**
 * One home or office usually holds a whole IPv6 /56, so count the network rather than each address in it.
 * IPv4-mapped addresses count as the IPv4 address they carry.
 */
function network(raw: string): string {
  const ip = raw.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (!ip.includes(":")) return ip;
  const mapped = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip.replace(/^::/, "0:"));
  if (mapped) return mapped[1]!;
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  const hex = groups.slice(0, 4).map((g) => g.padStart(4, "0")).join("");
  return `${hex.slice(0, 14)}::/56`;
}

export function clientId(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(`client:${network(ip)}`).digest("base64url").slice(0, 22);
}

export async function pruneRateLimits(db: Db, now = new Date()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * DAY)));
}
