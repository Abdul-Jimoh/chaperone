import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlm, LlmOutputError } from "@/lib/llm/llm";
import type { Transport } from "@/lib/llm/transport";
import { compileMandate, draftToPolicy, type MandateDraft, type Shop } from "@/lib/policy/compile";
import { resetDb, testDb } from "./support/db";
import { ROGUE, SHOP_A, SHOP_B } from "./support/fixtures";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SHOP_C = "SHOPCCCCCCCCC";
const shops: Shop[] = [
  { key: "bean-supply", name: "Bean Supply Co", merchantId: SHOP_A },
  { key: "pet-pantry", name: "Pet Pantry", merchantId: SHOP_B },
  { key: "home-basics", name: "Home Basics", merchantId: SHOP_C },
];
const context = { shops, timezone: "America/New_York", now: new Date("2026-11-01T12:00:00Z") };

const empty: MandateDraft = {
  shops: [],
  categories: [],
  perPurchaseMaxUsd: null,
  askAboveUsd: null,
  budgets: [],
  maxQuantityPerItem: null,
  schedule: null,
  validForDays: null,
  notEnforceable: [],
};

// "Coffee and dog food every two weeks, max $80 a run, $150 a month, only these 3 shops, ask me over $40."
const demoDraft: MandateDraft = {
  ...empty,
  shops: ["bean-supply", "pet-pantry", "home-basics"],
  categories: ["Coffee", "dog food"],
  perPurchaseMaxUsd: 80,
  askAboveUsd: 40,
  budgets: [
    { period: "run", maxUsd: 80 },
    { period: "month", maxUsd: 150 },
  ],
  schedule: { every: 2, unit: "week" },
};

describe("draftToPolicy", () => {
  it("turns the demo draft into a valid policy and a read-back", () => {
    const result = draftToPolicy(demoDraft, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy).toMatchObject({
      perTransactionCapCents: 8000,
      approvalThresholdCents: 4000,
      budgets: [
        { period: "run", limitCents: 8000 },
        { period: "month", limitCents: 15000 },
      ],
      categories: ["coffee", "dog-food"],
      schedule: { every: 2, unit: "week" },
      expiresAt: null,
    });
    expect(result.policy.merchants.map((m) => m.merchantId)).toEqual([SHOP_A, SHOP_B, SHOP_C]);
    expect(result.readBack).toContain("Ask me before anything over $40.00");
    expect(result.readBack).toContain("Spend at most $150.00 per month");
  });

  it("caps each purchase at the tightest budget when no per-purchase cap was given", () => {
    const result = draftToPolicy(
      { ...demoDraft, perPurchaseMaxUsd: null, budgets: [{ period: "week", maxUsd: 60 }, { period: "month", maxUsd: 150 }] },
      context,
    );
    expect(result.ok && result.policy.perTransactionCapCents).toBe(6000);
  });

  it("asks for a spending limit when none was stated", () => {
    const result = draftToPolicy({ ...demoDraft, perPurchaseMaxUsd: null, budgets: [] }, context);
    expect(result).toEqual({ ok: false, problems: [expect.stringContaining("how much")] });
  });

  it("asks for a shop when none was allowed", () => {
    const result = draftToPolicy({ ...demoDraft, shops: [] }, context);
    expect(result.ok).toBe(false);
  });

  it("rejects limits above the hard ceiling instead of clamping them", () => {
    const result = draftToPolicy({ ...demoDraft, budgets: [{ period: "month", maxUsd: 50_000 }] }, context);
    expect(result.ok).toBe(false);
  });

  it("computes expiry from the stated duration", () => {
    const result = draftToPolicy({ ...demoDraft, validForDays: 90 }, context);
    expect(result.ok && result.policy.expiresAt).toBe("2027-01-30T12:00:00.000Z");
  });
});

function replying(draft: unknown): Transport {
  return vi.fn<Transport>(async () => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify(draft), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Message);
}

describe("compileMandate", () => {
  const statement = "Coffee and dog food every two weeks, max $80 a run, $150 a month, only these 3 shops, ask me over $40.";

  it("never shows Claude a merchant ID, so it can't choose a payee", async () => {
    const transport = replying(demoDraft);
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    const result = await compileMandate(llm, { statement, ...context });
    expect(result.ok).toBe(true);
    const sent = JSON.stringify(vi.mocked(transport).mock.calls[0]![0]);
    for (const id of [SHOP_A, SHOP_B, SHOP_C]) expect(sent).not.toContain(id);
  });

  it("rejects a draft naming a shop that isn't in the directory", async () => {
    const llm = createLlm({ db, transport: replying({ ...demoDraft, shops: ["bean-supply", ROGUE] }), budgetUsd: 1.5 });
    await expect(compileMandate(llm, { statement, ...context })).rejects.toBeInstanceOf(LlmOutputError);
  });
});
