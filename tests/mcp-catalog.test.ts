import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { payments } from "@/db/schema";
import { demoCatalog } from "@/lib/catalog";
import { createLlm } from "@/lib/llm/llm";
import type { PaymentDeps } from "@/lib/payments/service";
import { handleMcpRequest } from "@/mcp/http";
import { issueAgentKey } from "@/mcp/keys";
import { checkMandate, requestPaymentTool, searchProducts, type Shopping } from "@/mcp/tools";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";
import { scriptedTransport } from "./support/scripted-llm";

const { db, pool } = testDb(10);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SHOP_C = "SHOPCCCCCCCCC";
const shops = [
  { key: "corner-market", name: "Corner Market", merchantId: SHOP_A, sells: "" },
  { key: "pet-pantry", name: "Pet Pantry", merchantId: SHOP_B, sells: "" },
  { key: "home-basics", name: "Home Basics", merchantId: SHOP_C, sells: "" },
];
const catalog = demoCatalog(shops, ROGUE);
const policy = samplePolicy({
  merchants: shops.map((s) => ({ merchantId: s.merchantId, name: s.name })),
  categories: ["dog-food", "paper-towels", "dish-soap"],
  maxQuantityPerItem: null,
});

function setup(withClaude = true, classifyCalls = { n: 0 }) {
  const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B, "shop-c-app": SHOP_C });
  const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees };
  const { transport } = scriptedTransport([], (titles) => {
    classifyCalls.n++;
    return Object.fromEntries(Object.entries(titles).map(([id, t]) => [id, /dog food/i.test(t) ? "dog-food" : /paper towels/i.test(t) ? "paper-towels" : "other"]));
  });
  const llm = createLlm({ db, transport, budgetUsd: 1.5, cache: true });
  const shopping: Shopping = { catalog, ...(withClaude ? { llm: () => llm } : {}) };
  return { paypal, deps, shopping };
}

describe("search_products over MCP", () => {
  it("lists real prices and sellers, and says which shops are on the user's list", async () => {
    const { shopping } = setup();
    const { listings } = await searchProducts(shopping, policy, "dry dog food");
    expect(listings).toContainEqual(expect.objectContaining({ listing_id: "pp-dry-dog-food-5kg", price_cents: 2_649, shop: "Pet Pantry", merchant_id: SHOP_B, shop_on_users_list: true }));
    expect(listings).toContainEqual(expect.objectContaining({ listing_id: "bpd-dry-dog-food-5kg", merchant_id: ROGUE, shop_on_users_list: false }));
  });

  it("is offered to a connected agent alongside the payment tools", async () => {
    const { deps, shopping } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const key = await issueAgentKey(db, mandate.id, "agent");
    const client = new Client({ name: "agent", version: "1.0.0" });
    const handler: typeof fetch = async (input, init) => handleMcpRequest(new Request(input, init), deps, { shopping });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://chaperone.test/api/mcp"), { fetch: handler, requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "paper towels" } });
    expect((result.content as { text: string }[])[0]!.text).toContain("hb-paper-towels-12");
    await client.close();
  });
});

describe("request_payment with catalog listings", () => {
  it("pays the listing's seller at the catalog's price, with Claude's category", async () => {
    const { deps, shopping, paypal } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const result = await requestPaymentTool(deps, mandate.id, { items: [{ listing_id: "pp-dry-dog-food-5kg", quantity: 1, unit_price_cents: 1 }] }, shopping);
    expect(result).toMatchObject({ decision: "allow", status: "captured", total_cents: 2_649 });
    const [paid] = await db.select().from(payments);
    expect(paid).toMatchObject({ payeeMerchantId: SHOP_B });
    expect(paid!.items).toEqual([{ productId: "pp-dry-dog-food-5kg", title: "Dry dog food, chicken and rice, 5 kg", unitPriceCents: 2_649, quantity: 1, category: "dog-food" }]);
    expect(paypal.ops()).toContain("capture:platform-app");
  });

  it("refuses a listing paid to another shop, mixed sellers and unknown listings, recording nothing", async () => {
    const { deps, shopping } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const ask = (input: Parameters<typeof requestPaymentTool>[2]) => requestPaymentTool(deps, mandate.id, input, shopping);
    expect(await ask({ payee_merchant_id: SHOP_B, items: [{ listing_id: "bpd-dry-dog-food-5kg", quantity: 10 }] })).toMatchObject({ error: "invalid_cart" });
    expect(await ask({ items: [{ listing_id: "pp-dry-dog-food-5kg", quantity: 1 }, { listing_id: "hb-paper-towels-12", quantity: 1 }] })).toMatchObject({ error: "invalid_cart" });
    expect(await ask({ items: [{ listing_id: "made-up", quantity: 1 }] })).toMatchObject({ error: "invalid_cart" });
    expect(await ask({ items: [{ title: "No price", quantity: 1 }] })).toMatchObject({ error: "invalid_cart" });
    expect(await db.select().from(payments)).toEqual([]);
  });

  it("denies the planted listing on its seller, and asks the user when Claude can't classify", async () => {
    const { deps, shopping } = setup(false);
    const mandate = await seedLinkedMandate(db, policy);
    expect(await requestPaymentTool(deps, mandate.id, { items: [{ listing_id: "bpd-dry-dog-food-5kg", quantity: 10 }] }, shopping)).toMatchObject({ decision: "deny" });
    expect(await requestPaymentTool(deps, mandate.id, { items: [{ listing_id: "pp-dog-treats", quantity: 1 }] }, shopping)).toMatchObject({ decision: "needs_approval" });
  });

  it("won't take a made-up price or category for a shop that sells through the catalog", async () => {
    const { deps, shopping } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const madeUp = { payee_merchant_id: SHOP_C, items: [{ product_id: "hb-paper-towels-12", title: "Paper towels, 12 rolls", unit_price_cents: 1, quantity: 1, category: "dog-food" }] };
    expect(await requestPaymentTool(deps, mandate.id, madeUp, shopping)).toMatchObject({ error: "invalid_cart" });
    expect(await db.select().from(payments)).toEqual([]);
  });

  it("won't take shipping or tax from an agent for a catalog shop", async () => {
    const { deps, shopping } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const padded = await requestPaymentTool(deps, mandate.id, { items: [{ listing_id: "hb-dish-soap-750", quantity: 1 }], shipping_cents: 3_000 }, shopping);
    expect(padded).toMatchObject({ error: "invalid_cart" });
    expect(await requestPaymentTool(deps, mandate.id, { items: [{ listing_id: "hb-dish-soap-750", quantity: 1 }], tax_cents: 100 }, shopping)).toMatchObject({ error: "invalid_cart" });
    expect(await db.select().from(payments)).toEqual([]);
  });

  it("counts everything MCP agents spend in a day against the per-run budget", async () => {
    const { deps, shopping } = setup();
    const clock = { now: new Date("2026-11-03T15:00:00Z") };
    const timed = { ...deps, clock: () => clock.now };
    const mandate = await seedLinkedMandate(db, policy);
    const buy = (listing: string, quantity: number) => requestPaymentTool(timed, mandate.id, { items: [{ listing_id: listing, quantity }] }, shopping);
    expect(await buy("pp-dry-dog-food-5kg", 2)).toMatchObject({ decision: "needs_approval" });
    expect(await buy("pp-dry-dog-food-5kg", 1)).toMatchObject({ decision: "allow" });
    expect(await buy("hb-paper-towels-12", 1)).toMatchObject({ decision: "deny", clause_id: "budget.run" });
    expect((await checkMandate(timed, mandate.id, undefined, shopping)).budgets.find((b) => b.period === "run")).toMatchObject({ used_cents: 7_947 });

    clock.now = new Date("2026-11-04T15:00:00Z");
    expect(await buy("hb-paper-towels-12", 1)).toMatchObject({ decision: "allow" });
  });

  it("ignores the category an agent claims for a shop outside the catalog, so the user is asked", async () => {
    const { deps, shopping } = setup();
    const outside = "OUTSIDESHOP01";
    const mandate = await seedLinkedMandate(db, { ...policy, merchants: [...policy.merchants, { merchantId: outside, name: "Outside Shop" }] });
    const result = await requestPaymentTool(deps, mandate.id, { payee_merchant_id: outside, items: [{ title: "A television", unit_price_cents: 1_000, quantity: 1, category: "dog-food" }] }, shopping);
    expect(result).toMatchObject({ decision: "needs_approval" });
    expect((await db.select().from(payments))[0]!.items[0]!.category).toBeNull();
  });

  it("classifies each listing once per set of rules, however carts are shuffled", async () => {
    const calls = { n: 0 };
    const { deps, shopping } = setup(true, calls);
    const mandate = await seedLinkedMandate(db, policy);
    for (const quantity of [1, 2, 3]) {
      await checkMandate(deps, mandate.id, { items: [{ listing_id: "hb-paper-towels-12", quantity }, { listing_id: "hb-dish-soap-750", quantity }] }, shopping);
      await checkMandate(deps, mandate.id, { items: [{ listing_id: "hb-dish-soap-750", quantity }, { listing_id: "hb-paper-towels-12", quantity }] }, shopping);
    }
    expect(calls.n).toBe(2);
  });

  it("refuses carts of more than 20 items at the MCP boundary", async () => {
    const { deps, shopping } = setup();
    const mandate = await seedLinkedMandate(db, policy);
    const key = await issueAgentKey(db, mandate.id, "agent");
    const client = new Client({ name: "agent", version: "1.0.0" });
    const handler: typeof fetch = async (input, init) => handleMcpRequest(new Request(input, init), deps, { shopping });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://chaperone.test/api/mcp"), { fetch: handler, requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    const result = await client.callTool({ name: "request_payment", arguments: { items: Array.from({ length: 21 }, () => ({ listing_id: "hb-sponges-6", quantity: 1 })) } });
    expect(result.isError).toBe(true);
    expect(await db.select().from(payments)).toEqual([]);
    await client.close();
  });
});
