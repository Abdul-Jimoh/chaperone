import type { Shop } from "@/lib/policy/compile";
import type { Policy } from "@/lib/policy/schema";
import type { DemoShop } from "@/lib/shops";

/** Inputs shared by scripts/record-llm.ts and the replay tests; a recording only replays for an identical request. */
export const FIXTURE_DIR = "tests/fixtures/llm";

export const DEMO_STATEMENT =
  "Buy coffee and dog food every two weeks. Max $80 per run and $150 a month. Only use these 3 shops. Ask me before anything over $40.";

export const DEMO_TIMEZONE = "America/New_York";

export const DEMO_SHOPS: Shop[] = [
  { key: "bean-supply", name: "Bean Supply Co", merchantId: "SHOPAAAAAAAAA" },
  { key: "pet-pantry", name: "Pet Pantry", merchantId: "SHOPBBBBBBBBB" },
  { key: "home-basics", name: "Home Basics", merchantId: "SHOPCCCCCCCCC" },
];

export const CHANNEL3_FIXTURE_DIR = "tests/fixtures/channel3";

export const DEMO_AGENT_GOAL = "It's restock day. Buy one bag of coffee and one bag of dry dog food.";

export const DEMO_AGENT_SHOPS: DemoShop[] = [
  { ...DEMO_SHOPS[0]!, sells: "coffee beans and ground coffee" },
  { ...DEMO_SHOPS[1]!, sells: "dog and cat food, treats and pet supplies" },
  { ...DEMO_SHOPS[2]!, sells: "household and kitchen supplies" },
];

/** The demo mandate as compiled from DEMO_STATEMENT (see the recorded compile fixture). */
export const DEMO_POLICY: Policy = {
  version: 1,
  currency: "USD",
  timezone: DEMO_TIMEZONE,
  perTransactionCapCents: 8_000,
  approvalThresholdCents: 4_000,
  budgets: [
    { period: "run", limitCents: 8_000 },
    { period: "month", limitCents: 15_000 },
  ],
  merchants: DEMO_SHOPS.map((s) => ({ merchantId: s.merchantId, name: s.name })),
  categories: ["coffee", "dog-food"],
  maxQuantityPerItem: null,
  schedule: { every: 2, unit: "week" },
  expiresAt: null,
};
