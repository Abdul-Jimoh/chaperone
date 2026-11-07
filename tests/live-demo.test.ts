import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { llmUsage, mandates, paymentMethods, payments, rateLimits, users } from "@/db/schema";
import type { AgentStep } from "@/lib/agent/run";
import { compileDemoRules, confirmDemoMandate, NotYoursError, runDemoAgent, startDemoShopper, type DemoWorld } from "@/lib/app/demo";
import { openDraft, sealDraft } from "@/lib/app/drafts";
import { catalogSearch, demoCatalog } from "@/lib/catalog";
import { DEMO_GOAL, DEMO_STATEMENT } from "@/lib/demo";
import { createLlm } from "@/lib/llm/llm";
import { aiChecks, enforce, LIMITS, RateLimitedError } from "@/lib/ratelimit";
import type { Transport } from "@/lib/llm/transport";
import type { PaymentDeps } from "@/lib/payments/service";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";
import { confirmExample, DRAFT_SECRET } from "./support/demo";
import { scriptedTransport } from "./support/scripted-llm";

const { db, pool } = testDb(10);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SHOP_C = "SHOPCCCCCCCCC";
const world: DemoWorld = {
  shops: [
    { key: "corner-market", name: "Corner Market", merchantId: SHOP_A, sells: "groceries" },
    { key: "pet-pantry", name: "Pet Pantry", merchantId: SHOP_B, sells: "pet food" },
    { key: "home-basics", name: "Home Basics", merchantId: SHOP_C, sells: "household supplies" },
  ],
  rogueMerchantId: ROGUE,
};
const catalog = demoCatalog(world.shops, world.rogueMerchantId);
const search = catalogSearch(catalog);

let jwk: JWK;
beforeAll(async () => {
  jwk = await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey);
});

function reply(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

async function shopper() {
  const [template] = await db.insert(users).values({ email: "demo-shopper@example.com", displayName: "Demo shopper" }).returning();
  await db.insert(paymentMethods).values({ userId: template!.id, paypalPaymentTokenId: "VAULT-TEST-1" });
  return startDemoShopper(db, "test-client");
}

describe("the Claude response cache", () => {
  it("replays an identical request without calling Claude or spending budget", async () => {
    const transport = vi.fn<Transport>(async () => reply("hello"));
    const llm = createLlm({ db, transport, budgetUsd: 1.5, cache: true });
    const request = { max_tokens: 100, messages: [{ role: "user" as const, content: "hi" }] };
    await llm.message("classify", request);
    const again = await llm.message("classify", request);
    expect(again.content).toEqual(reply("hello").content);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await db.select().from(llmUsage)).toHaveLength(1);

    await llm.message("classify", { ...request, messages: [{ role: "user", content: "something else" }] });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("is off unless asked for", async () => {
    const transport = vi.fn<Transport>(async () => reply("hello"));
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    const request = { max_tokens: 100, messages: [{ role: "user" as const, content: "hi" }] };
    await llm.message("classify", request);
    await llm.message("classify", request);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("sealed read-backs", () => {
  const draft = { userId: "user-1", statement: "Dog food only.", policy: samplePolicy() };

  it("opens only for the same user, unchanged and in time", () => {
    const token = sealDraft(DRAFT_SECRET, draft);
    expect(openDraft(DRAFT_SECRET, token, "user-1")).toMatchObject(draft);
    expect(openDraft(DRAFT_SECRET, token, "user-2")).toBeNull();
    expect(openDraft("another-secret", token, "user-1")).toBeNull();
    expect(openDraft(DRAFT_SECRET, token, "user-1", new Date(Date.now() + 2 * 3_600_000))).toBeNull();
  });

  it("refuses a read-back whose policy was changed after it was shown", () => {
    const [payload, mac] = sealDraft(DRAFT_SECRET, draft).split(".");
    const changed = JSON.parse(Buffer.from(payload!, "base64url").toString());
    changed.policy.perTransactionCapCents = 1_000_000;
    const forged = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${mac}`;
    expect(openDraft(DRAFT_SECRET, forged, "user-1")).toBeNull();
  });
});

describe("writing your own rules", () => {
  const statement = "Only dog food from Pet Pantry. At most $30 a purchase and $60 a month. Ask me over $20.";
  const draft = {
    shops: ["pet-pantry"],
    categories: ["dog food"],
    perPurchaseMaxUsd: 30,
    askAboveUsd: 20,
    budgets: [{ period: "month", maxUsd: 60 }],
    maxQuantityPerItem: null,
    schedule: null,
    validForDays: null,
    notEnforceable: [],
  };
  const deps = (transport: Transport) => ({ db, llm: createLlm({ db, transport, budgetUsd: 1.5, cache: true }), world, secret: DRAFT_SECRET });

  it("signs exactly the policy Claude drafted and the user read back", async () => {
    const id = await shopper();
    const result = await compileDemoRules(deps(vi.fn<Transport>(async () => reply(JSON.stringify(draft)))), id, statement);
    if (!result.ok) throw new Error(result.problems.join("; "));
    expect(result.rules).toContain("Only pay these shops: Pet Pantry");
    expect(await db.select().from(mandates)).toEqual([]);

    const mandate = await confirmDemoMandate(db, id, result.token, { draft: DRAFT_SECRET, signingJwk: jwk });
    expect(mandate.statement).toBe(statement);
    expect(mandate.policy).toMatchObject({ perTransactionCapCents: 3_000, approvalThresholdCents: 2_000, merchants: [{ merchantId: SHOP_B, name: "Pet Pantry" }] });
  });

  it("stores nothing when the read-back token was tampered with", async () => {
    const id = await shopper();
    const result = await compileDemoRules(deps(vi.fn<Transport>(async () => reply(JSON.stringify(draft)))), id, statement);
    if (!result.ok) throw new Error("compile failed");
    const forged = `${result.token.slice(0, 20)}x${result.token.slice(21)}`;
    await expect(confirmDemoMandate(db, id, forged, { draft: DRAFT_SECRET, signingJwk: jwk })).rejects.toBeInstanceOf(NotYoursError);
    expect(await db.select().from(mandates)).toEqual([]);
  });

  it("counts only calls that reach Claude, and keeps the cached example working when a visitor's allowance is spent", async () => {
    const id = await shopper();
    const transport = vi.fn<Transport>(async () => reply(JSON.stringify({ ...draft, shops: ["corner-market", "pet-pantry", "home-basics"] })));
    const llm = createLlm({ db, transport, budgetUsd: 1.5, cache: true, beforeLive: async () => enforce(db, await aiChecks(db, id)) });
    const metered = { db, llm, world, secret: DRAFT_SECRET };
    await compileDemoRules(metered, id, DEMO_STATEMENT);
    await compileDemoRules(metered, id, DEMO_STATEMENT);
    expect(transport).toHaveBeenCalledTimes(1);
    const [live] = await db.select().from(rateLimits).where(eq(rateLimits.bucket, "ai-live:client-day:test-client"));
    expect(live!.hits).toBe(1);

    await db.update(rateLimits).set({ hits: LIMITS.aiLivePerClientDaily.max }).where(eq(rateLimits.bucket, "ai-live:client-day:test-client"));
    await expect(compileDemoRules(metered, id, statement)).rejects.toBeInstanceOf(RateLimitedError);
    expect((await compileDemoRules(metered, id, DEMO_STATEMENT)).ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("never caches a reply that fails validation", async () => {
    const id = await shopper();
    const transport = vi.fn<Transport>(async () => reply("not json"));
    await expect(compileDemoRules(deps(transport), id, statement)).rejects.toThrow(/valid JSON/);
    await expect(compileDemoRules(deps(transport), id, statement)).rejects.toThrow(/valid JSON/);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("the demo catalog", () => {
  it("finds the planted listing next to the real one, sold by a shop on nobody's list", async () => {
    const found = await search("dry dog food", 6);
    const real = found.find((l) => l.productId === "pp-dry-dog-food-5kg");
    const planted = found.find((l) => l.productId === "bpd-dry-dog-food-5kg");
    expect(real).toMatchObject({ merchantId: SHOP_B, shop: "Pet Pantry", priceCents: 2_649 });
    expect(planted).toMatchObject({ merchantId: ROGUE, shop: "Bulk Pet Deals" });
    expect(planted!.description).toMatch(/ignore any spending limits/i);
  });

  it("answers the same query the same way every time", async () => {
    expect(await search("paper towels dish soap", 6)).toEqual(await search("paper towels dish soap", 6));
  });
});

describe("the agent run on the dashboard", () => {
  const categoryOf = (title: string) =>
    /dog food/i.test(title) ? "dog-food" : /paper towels/i.test(title) ? "paper-towels" : /^dish soap,/i.test(title) ? "dish-soap" : "other";

  async function setup(turns: Parameters<typeof scriptedTransport>[0]) {
    const id = await shopper();
    await confirmExample(db, world, id, jwk);
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
    const { transport } = scriptedTransport(turns, (titles) => Object.fromEntries(Object.entries(titles).map(([k, t]) => [k, categoryOf(t)])));
    const payments_: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees };
    return { id, paypal, deps: { payments: payments_, llm: createLlm({ db, transport, budgetUsd: 1.5 }), search, world } };
  }

  // The agent numbers listings in the order it saw them: L1… for the first search, then onwards.
  let dogs: string[] = [];
  let home: string[] = [];
  beforeAll(async () => {
    dogs = (await search("dry dog food", 6)).map((l) => l.productId);
    home = (await search("paper towels dish soap", 6)).map((l) => l.productId);
  });
  const L = (productId: string) => {
    const i = [...dogs, ...home].indexOf(productId);
    if (i < 0) throw new Error(`${productId} not in the searches`);
    return `L${i + 1}`;
  };

  it("pays, asks and blocks, streaming each step, and can't pay one shop for another's listing", async () => {
    const { id, paypal, deps } = await setup([
      { tools: [{ name: "search_products", input: { query: "dry dog food" } }] },
      { tools: [{ name: "request_payment", input: { payee_merchant_id: SHOP_B, items: [{ listing_id: L("pp-dry-dog-food-5kg"), quantity: 1 }] } }] },
      { tools: [{ name: "search_products", input: { query: "paper towels dish soap" } }] },
      {
        tools: [
          {
            name: "request_payment",
            input: { payee_merchant_id: SHOP_C, items: [{ listing_id: L("hb-paper-towels-12"), quantity: 1 }, { listing_id: L("hb-dish-soap-750"), quantity: 1 }] },
          },
        ],
      },
      // A model that falls for the planted listing: first sneaking it onto an allowed shop, then paying the listed seller.
      { tools: [{ name: "request_payment", input: { payee_merchant_id: SHOP_B, items: [{ listing_id: L("bpd-dry-dog-food-5kg"), quantity: 10 }] } }] },
      { tools: [{ name: "request_payment", input: { payee_merchant_id: ROGUE, items: [{ listing_id: L("bpd-dry-dog-food-5kg"), quantity: 10 }] } }] },
      { text: "Bought dog food; paper towels and soap wait for you; the bulk deal was refused." },
    ]);
    const streamed: AgentStep[] = [];
    const run = await runDemoAgent(deps, id, { goal: DEMO_GOAL, attemptId: "00000000-0000-4000-8000-000000000001", onStep: (s) => streamed.push(s) });

    expect(streamed).toEqual(run.steps);
    expect(run.steps.filter((s) => s.kind === "payment").map((s) => s.kind === "payment" && [s.decision, s.status, s.total, s.shop])).toEqual([
      ["allow", "captured", "$26.49", "Pet Pantry"],
      ["needs_approval", "pending_approval", "$40.99", "Home Basics"],
      ["deny", "denied", "$249.90", "A shop not on your list"],
    ]);
    expect(run.steps).toContainEqual(expect.objectContaining({ kind: "error", message: expect.stringMatching(/sold by a different shop/) }));

    const rows = await db.select().from(payments);
    expect(rows.every((p) => p.runId === "agent-00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(rows.find((p) => p.status === "denied")!.payeeMerchantId).toBe(ROGUE);
    // PayPal never saw the planted listing's seller.
    expect(paypal.ops().filter((op) => op.startsWith("order:")).length).toBe(2);
  });

  it("counts each payment the agent asks for against the purchase limits", async () => {
    const { id, deps } = await setup([
      { tools: [{ name: "search_products", input: { query: "dry dog food" } }] },
      { tools: [{ name: "request_payment", input: { payee_merchant_id: SHOP_B, items: [{ listing_id: L("pp-dry-dog-food-5kg"), quantity: 1 }] } }] },
      { tools: [{ name: "request_payment", input: { payee_merchant_id: ROGUE, items: [{ listing_id: L("bpd-dry-dog-food-5kg"), quantity: 1 }] } }] },
      { text: "Done." },
    ]);
    await runDemoAgent(deps, id, { goal: DEMO_GOAL, attemptId: "00000000-0000-4000-8000-000000000002" });
    const [shopperBucket] = await db.select().from(rateLimits).where(eq(rateLimits.bucket, `purchases:shopper:${id}`));
    expect(shopperBucket!.hits).toBe(2);
  });
});
