import type { Shop } from "@/lib/policy/compile";
import type { Policy } from "@/lib/policy/schema";

/** The demo shopper's mandate, in their words. Seeding, judge mode and the recorded fixtures all start from this. */
export const DEMO_STATEMENT =
  "Buy dog food and household basics like paper towels and dish soap every two weeks. Max $80 per run and $150 a month. Only use these 3 shops. Ask me before anything over $40.";

export const DEMO_TIMEZONE = "America/New_York";

/** What Claude said it couldn't turn into a rule when it compiled DEMO_STATEMENT (tests/fixtures/llm). */
export const DEMO_NOT_ENFORCED = [
  "household basics like paper towels and dish soap (listed as examples; treated as the categories above, but other household basics were not specified)",
];

export const DEMO_GOAL = "It's restock day. Buy a bag of dry dog food, a pack of paper towels and a bottle of dish soap.";

/** DEMO_STATEMENT exactly as Claude compiled it (recorded in tests/fixtures/llm) and the user would confirm it. */
export function demoPolicy(shops: Shop[]): Policy {
  return {
    version: 1,
    currency: "USD",
    timezone: DEMO_TIMEZONE,
    perTransactionCapCents: 8_000,
    approvalThresholdCents: 4_000,
    budgets: [
      { period: "run", limitCents: 8_000 },
      { period: "month", limitCents: 15_000 },
    ],
    merchants: shops.map((s) => ({ merchantId: s.merchantId, name: s.name })),
    categories: ["dog-food", "paper-towels", "dish-soap"],
    maxQuantityPerItem: null,
    schedule: { every: 2, unit: "week" },
    expiresAt: null,
  };
}
