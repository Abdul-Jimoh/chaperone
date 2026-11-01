import type { Shop } from "@/lib/policy/compile";

export type DemoShop = Shop & { sells: string };

type EnvLike = Partial<Record<string, unknown>>;

const SHOPS = [
  { env: "A", key: "corner-market", name: "Corner Market", sells: "everyday groceries and household basics" },
  { env: "B", key: "pet-pantry", name: "Pet Pantry", sells: "dog and cat food, treats and pet supplies" },
  { env: "C", key: "home-basics", name: "Home Basics", sells: "household and kitchen supplies" },
] as const;

/** The three sandbox shops. Each is a separate PayPal business account, so every purchase has a real payee. */
export function demoShops(env: EnvLike): DemoShop[] {
  return SHOPS.flatMap(({ env: letter, ...shop }) => {
    const merchantId = env[`PAYPAL_SHOP_${letter}_MERCHANT_ID`];
    return typeof merchantId === "string" && merchantId ? [{ ...shop, merchantId }] : [];
  });
}
