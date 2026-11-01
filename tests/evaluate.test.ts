import { describe, expect, it } from "vitest";
import { evaluate, type EvaluationInput } from "@/lib/policy/evaluate";
import { ROGUE, SHOP_B, cart, samplePolicy } from "./support/fixtures";

const now = new Date("2026-11-03T15:00:00Z");

function run(overrides: Partial<EvaluationInput> = {}) {
  return evaluate({ policy: samplePolicy(), mandateStatus: "active", cart: cart(), spent: {}, now, ...overrides });
}

describe("evaluate", () => {
  it("allows a cart inside every limit", () => {
    const r = run();
    expect(r.decision).toBe("allow");
    expect(r.clause.id).toBe("within_limits");
    expect(r.totalCents).toBe(1_800);
    expect(r.checks.every((c) => c.outcome === "pass")).toBe(true);
  });

  it("denies the prompt-injected cart on both the payee allowlist and the cap", () => {
    const injected = cart({
      payeeMerchantId: ROGUE,
      items: [{ title: "Whole bean coffee, 1 kg", unitPriceCents: 1_800, quantity: 10, category: "coffee" }],
    });
    const r = run({ cart: injected });
    expect(r.decision).toBe("deny");
    expect(r.clause.id).toBe("payee.allowlist");
    const denied = r.checks.filter((c) => c.outcome === "deny").map((c) => c.clause);
    expect(denied).toEqual(expect.arrayContaining(["payee.allowlist", "item.quantity", "txn.cap", "budget.run", "budget.month"]));
  });

  it("denies everything once the mandate is revoked", () => {
    const r = run({ mandateStatus: "revoked" });
    expect(r.decision).toBe("deny");
    expect(r.clause.id).toBe("mandate.revoked");
  });

  it("denies after expiry and allows just before it", () => {
    const policy = samplePolicy({ expiresAt: "2026-11-03T15:00:00Z" });
    expect(run({ policy, now: new Date("2026-11-03T14:59:59Z") }).decision).toBe("allow");
    expect(run({ policy }).clause.id).toBe("mandate.expired");
  });

  it("denies a different currency", () => {
    expect(run({ cart: cart({ currency: "EUR" }) }).clause.id).toBe("currency");
  });

  it("denies a category outside the allowlist", () => {
    const r = run({ cart: cart({ items: [{ title: "Phone charger", unitPriceCents: 1_500, quantity: 1, category: "electronics" }] }) });
    expect(r.decision).toBe("deny");
    expect(r.clause.id).toBe("item.category");
  });

  it("asks before buying an item it couldn't categorise", () => {
    const r = run({ cart: cart({ items: [{ title: "Mystery box", unitPriceCents: 1_000, quantity: 1, category: null }] }) });
    expect(r.decision).toBe("needs_approval");
    expect(r.clause.id).toBe("approval.category_unknown");
  });

  it("allows any category when the mandate lists none", () => {
    const policy = samplePolicy({ categories: [] });
    const r = run({ policy, cart: cart({ items: [{ title: "Mystery box", unitPriceCents: 1_000, quantity: 1, category: null }] }) });
    expect(r.decision).toBe("allow");
  });

  it("asks for approval strictly above the threshold, including shipping and tax", () => {
    expect(run({ cart: cart({ items: [{ title: "Dog food 10 kg", unitPriceCents: 4_000, quantity: 1, category: "dog-food" }], payeeMerchantId: SHOP_B }) }).decision).toBe("allow");
    const r = run({ cart: cart({ items: [{ title: "Dog food 10 kg", unitPriceCents: 4_000, quantity: 1, category: "dog-food" }], payeeMerchantId: SHOP_B, shippingCents: 1 }) });
    expect(r.decision).toBe("needs_approval");
    expect(r.clause.id).toBe("approval.threshold");
    expect(r.totalCents).toBe(4_001);
  });

  it("denies over the per-purchase cap even when approval would otherwise be asked", () => {
    const r = run({ cart: cart({ items: [{ title: "Espresso beans", unitPriceCents: 2_100, quantity: 4, category: "coffee" }] }) });
    expect(r.decision).toBe("deny");
    expect(r.clause.id).toBe("txn.cap");
  });

  it("denies over the quantity limit", () => {
    const r = run({ cart: cart({ items: [{ title: "Coffee pods", unitPriceCents: 100, quantity: 5, category: "coffee" }] }) });
    expect(r.clause.id).toBe("item.quantity");
  });

  it("denies when the cart would exceed a budget window, counting what's already spent", () => {
    expect(run({ spent: { month: 13_200 } }).decision).toBe("allow");
    const r = run({ spent: { month: 13_201 } });
    expect(r.decision).toBe("deny");
    expect(r.clause.id).toBe("budget.month");
    expect(r.clause.detail).toContain("$132.01 already used");
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });
});
