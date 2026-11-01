import { demoPolicy } from "@/lib/demo";
import type { Shop } from "@/lib/policy/compile";
import type { Policy } from "@/lib/policy/schema";
import type { DemoShop } from "@/lib/shops";

/** Inputs shared by scripts/record-llm.ts and the replay tests; a recording only replays for an identical request. */
export const FIXTURE_DIR = "tests/fixtures/llm";

export { DEMO_STATEMENT, DEMO_TIMEZONE } from "@/lib/demo";

export const DEMO_SHOPS: Shop[] = [
  { key: "corner-market", name: "Corner Market", merchantId: "SHOPAAAAAAAAA" },
  { key: "pet-pantry", name: "Pet Pantry", merchantId: "SHOPBBBBBBBBB" },
  { key: "home-basics", name: "Home Basics", merchantId: "SHOPCCCCCCCCC" },
];

export const CHANNEL3_FIXTURE_DIR = "tests/fixtures/channel3";

export { DEMO_GOAL as DEMO_AGENT_GOAL } from "@/lib/demo";

export const DEMO_AGENT_SHOPS: DemoShop[] = [
  { ...DEMO_SHOPS[0]!, sells: "everyday groceries and household basics" },
  { ...DEMO_SHOPS[1]!, sells: "dog and cat food, treats and pet supplies" },
  { ...DEMO_SHOPS[2]!, sells: "household and kitchen supplies" },
];

export const DEMO_POLICY: Policy = demoPolicy(DEMO_SHOPS);
