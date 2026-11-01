import type { Cart, Policy } from "@/lib/policy/schema";

export const SHOP_A = "SHOPAAAAAAAAA";
export const SHOP_B = "SHOPBBBBBBBBB";
export const ROGUE = "ROGUEXXXXXXXX";

/** "Restock coffee and dog food. Max $80 per run, $150 a month. Only these shops. Ask me before anything over $40." */
export function samplePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: 1,
    currency: "USD",
    timezone: "America/New_York",
    perTransactionCapCents: 8_000,
    approvalThresholdCents: 4_000,
    budgets: [
      { period: "run", limitCents: 8_000 },
      { period: "month", limitCents: 15_000 },
    ],
    merchants: [
      { merchantId: SHOP_A, name: "Bean Supply Co" },
      { merchantId: SHOP_B, name: "Pet Pantry" },
    ],
    categories: ["coffee", "dog-food"],
    maxQuantityPerItem: 4,
    schedule: { every: 2, unit: "week" },
    expiresAt: null,
    ...overrides,
  };
}

export function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    payeeMerchantId: SHOP_A,
    currency: "USD",
    items: [{ productId: "beans-1kg", title: "Whole bean coffee, 1 kg", unitPriceCents: 1_800, quantity: 1, category: "coffee" }],
    shippingCents: 0,
    taxCents: 0,
    ...overrides,
  };
}
