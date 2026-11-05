import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { payments, rateLimits } from "@/db/schema";
import type { PaymentDeps } from "@/lib/payments/service";
import { clientId, hit, LIMITS, pruneRateLimits, type Limit } from "@/lib/ratelimit";
import { handleMcpRequest } from "@/mcp/http";
import { issueAgentKey, resolveAgentKey } from "@/mcp/keys";
import { requestPaymentTool } from "@/mcp/tools";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { db, pool } = testDb(30);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const now = new Date("2026-11-05T10:20:00Z");
const tiny: Limit = { name: "test", max: 3, windowMs: 3_600_000, message: "Too many." };

describe("rate limits", () => {
  it("allows up to the limit in a window, then refuses until the next one", async () => {
    const verdicts = [];
    for (let i = 0; i < 4; i++) verdicts.push(await hit(db, [[tiny, "a"]], now));
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false]);
    expect(verdicts[3]).toMatchObject({ ok: false, retryAfterSec: 40 * 60 });
    expect((await hit(db, [[tiny, "b"]], now)).ok).toBe(true);
    expect((await hit(db, [[tiny, "a"]], new Date("2026-11-05T11:00:00Z"))).ok).toBe(true);
  });

  it("can't be slipped past with parallel requests", async () => {
    const limit = { ...tiny, max: 10 };
    const verdicts = await Promise.all(Array.from({ length: 25 }, () => hit(db, [[limit, "x"]], now)));
    expect(verdicts.filter((v) => v.ok)).toHaveLength(10);
  });

  it("refuses when any of several limits is full", async () => {
    const global = { ...tiny, name: "global", max: 1 };
    expect((await hit(db, [[tiny, "a"], [global, null]], now)).ok).toBe(true);
    expect(await hit(db, [[tiny, "b"], [global, null]], now)).toMatchObject({ ok: false, limit: { name: "global" } });
  });

  it("stores a keyed hash of the visitor, never the address", async () => {
    const id = clientId("203.0.113.7", "secret-one-that-is-long-enough-000");
    expect(id).not.toContain("203");
    expect(id).not.toEqual(clientId("203.0.113.7", "another-secret-that-is-long-enough"));
    await hit(db, [[tiny, id]], now);
    expect(JSON.stringify(await db.select().from(rateLimits))).not.toContain("203.0.113.7");
  });

  it("prunes windows older than two days", async () => {
    await hit(db, [[tiny, "old"]], new Date("2026-11-01T00:00:00Z"));
    await hit(db, [[tiny, "new"]], now);
    await pruneRateLimits(db, now);
    expect((await db.select().from(rateLimits)).map((r) => r.bucket)).toEqual(["test:new"]);
  });
});

describe("rate limits on the agent side", () => {
  async function setup() {
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
    const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees, clock: () => now };
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const key = await issueAgentKey(db, mandate.id, "test agent");
    return { paypal, deps, mandate, key };
  }

  const fill = async (limit: Limit, subject: string | null) => {
    for (let i = 0; i < limit.max; i++) await hit(db, [[limit, subject]], now);
  };

  it("answers 429 with Retry-After once an agent key has used its calls", async () => {
    const { deps, key } = await setup();
    const { keyId } = (await resolveAgentKey(db, key, now))!;
    await fill(LIMITS.mcpCallsPerKey, keyId);
    const res = await handleMcpRequest(
      new Request("https://chaperone.test/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: "{}" }),
      deps,
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses a payment past the shared wallet's daily cap without recording it or calling PayPal", async () => {
    const { deps, mandate, paypal } = await setup();
    await db.insert(rateLimits).values({ bucket: LIMITS.purchasesAll.name, windowStart: new Date("2026-11-05T00:00:00Z"), hits: LIMITS.purchasesAll.max });
    const result = await requestPaymentTool(deps, mandate.id, {
      payee_merchant_id: SHOP_A,
      items: [{ title: "Whole bean coffee, 1 kg", unit_price_cents: 1_800, quantity: 1, category: "coffee" }],
    });
    expect(result).toMatchObject({ error: "rate_limited" });
    expect(await db.select().from(payments)).toEqual([]);
    expect(paypal.ops()).toEqual([]);
  });
});
