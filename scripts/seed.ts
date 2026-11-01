// Seeds the demo shopper, their linked sandbox wallet and the demo mandate, and issues an MCP agent key.
// pnpm tsx scripts/seed.ts   (uses DATABASE_URL from .env.local; the key goes to docs/private/agent-key.txt)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { paymentMethods, users } from "@/db/schema";
import { storeConfirmedMandate } from "@/lib/mandates";
import type { Policy } from "@/lib/policy/schema";
import { issueAgentKey } from "@/mcp/keys";
import { DEMO_STATEMENT, DEMO_TIMEZONE } from "../tests/support/llm-fixtures";

process.loadEnvFile(".env.local");
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
};

const STATE = "docs/private/spike-state.json";
const state = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as { vaultId?: string; customerId?: string }) : {};
const vaultId = process.env.DEMO_VAULT_ID ?? state.vaultId;
if (!vaultId) throw new Error("No vaulted wallet: run the vault spike or set DEMO_VAULT_ID.");

const policy: Policy = {
  version: 1,
  currency: "USD",
  timezone: DEMO_TIMEZONE,
  perTransactionCapCents: 8_000,
  approvalThresholdCents: 4_000,
  budgets: [
    { period: "run", limitCents: 8_000 },
    { period: "month", limitCents: 15_000 },
  ],
  merchants: [
    { merchantId: need("PAYPAL_SHOP_A_MERCHANT_ID"), name: "Bean Supply Co" },
    { merchantId: need("PAYPAL_SHOP_B_MERCHANT_ID"), name: "Pet Pantry" },
    { merchantId: need("PAYPAL_SHOP_C_MERCHANT_ID"), name: "Home Basics" },
  ],
  categories: ["coffee", "dog-food"],
  maxQuantityPerItem: null,
  schedule: { every: 2, unit: "week" },
  expiresAt: null,
};

const { db, pool } = createDb(need("DATABASE_URL"), { max: 2 });
try {
  const email = "demo-shopper@example.com";
  let [user] = await db.select().from(users).where(eq(users.email, email));
  user ??= (await db.insert(users).values({ email, displayName: "Demo shopper" }).returning())[0]!;
  await db
    .insert(paymentMethods)
    .values({ userId: user.id, paypalPaymentTokenId: vaultId, paypalCustomerId: state.customerId ?? null })
    .onConflictDoNothing();

  const mandate = await storeConfirmedMandate(db, {
    userId: user.id,
    statement: DEMO_STATEMENT,
    policy,
    signingJwk: JSON.parse(need("MANDATE_SIGNING_JWK")),
  });
  const key = await issueAgentKey(db, mandate.id, "seed");
  writeFileSync("docs/private/agent-key.txt", `${key}\n`, { mode: 0o600 });
  console.log(`user ${user.id}\nmandate ${mandate.id} (hash ${mandate.hash.slice(0, 12)}…)\nagent key written to docs/private/agent-key.txt`);
} finally {
  await pool.end();
}
