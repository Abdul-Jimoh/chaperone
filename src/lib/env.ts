import "server-only";
import { z } from "zod";

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: optional,
  DATABASE_URL_UNPOOLED: optional,
  ANTHROPIC_API_KEY: optional,
  LLM_BUDGET_USD: z.coerce.number().positive().default(1.5),
  CHANNEL3_API_KEY: optional,
  // Live mode is deliberately unsupported: this project only ever touches the PayPal sandbox.
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  PAYPAL_CLIENT_ID: optional,
  PAYPAL_CLIENT_SECRET: optional,
  PAYPAL_WEBHOOK_ID: optional,
  PAYPAL_SHOP_A_MERCHANT_ID: optional,
  PAYPAL_SHOP_B_MERCHANT_ID: optional,
  PAYPAL_SHOP_C_MERCHANT_ID: optional,
  PAYPAL_ROGUE_MERCHANT_ID: optional,
  // Each shop's own sandbox app. PayPal only lets the payee void a hold, so voids run with these.
  PAYPAL_SHOP_A_CLIENT_ID: optional,
  PAYPAL_SHOP_A_CLIENT_SECRET: optional,
  PAYPAL_SHOP_B_CLIENT_ID: optional,
  PAYPAL_SHOP_B_CLIENT_SECRET: optional,
  PAYPAL_SHOP_C_CLIENT_ID: optional,
  PAYPAL_SHOP_C_CLIENT_SECRET: optional,
  MANDATE_SIGNING_JWK: optional,
  APPROVAL_LINK_SECRET: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined) {
    throw new Error(`Missing env var ${key}. See docs/SETUP-CREDENTIALS.md.`);
  }
  return value as NonNullable<Env[K]>;
}
