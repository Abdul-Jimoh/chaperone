import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { rateLimits } from "@/db/schema";
import { resetDb, testDb } from "./support/db";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const secret = "cron-secret-for-tests-0123456789abcdef";
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

// The route reads its settings once per module load, so each case loads it fresh with its own env.
async function route(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...saved, DATABASE_URL: inject("databaseUrl"), PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y", APPROVAL_LINK_SECRET: "z".repeat(32), ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  return (await import("@/app/api/cron/sweep/route")).GET;
}
const call = (GET: (r: Request) => Promise<Response>, authorization?: string) =>
  GET(new Request("https://chaperone.test/api/cron/sweep", authorization ? { headers: { authorization } } : {}));

describe("GET /api/cron/sweep", () => {
  it("answers 503 naming the setting when CRON_SECRET isn't configured", async () => {
    const res = await call(await route({ CRON_SECRET: undefined }), `Bearer ${secret}`);
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toContain("CRON_SECRET");
  });

  it("answers 401 without Vercel's bearer secret", async () => {
    const GET = await route({ CRON_SECRET: secret });
    expect((await call(GET)).status).toBe(401);
    expect((await call(GET, `Bearer ${secret}x`)).status).toBe(401);
  });

  it("answers 200 with what it swept and drops rate-limit windows older than two days", async () => {
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await db.insert(rateLimits).values([
      { bucket: "old", windowStart: old, hits: 1 },
      { bucket: "new", windowStart: new Date(), hits: 1 },
    ]);
    const res = await call(await route({ CRON_SECRET: secret }), `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: [] });
    expect((await db.select().from(rateLimits)).map((r) => r.bucket)).toEqual(["new"]);
  });
});
