import type { Shop } from "@/lib/policy/compile";

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
