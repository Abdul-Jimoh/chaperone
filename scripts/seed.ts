// Seeds the demo shopper, their linked sandbox wallet and the demo mandate, and issues an MCP agent key.
// pnpm tsx scripts/seed.ts   (uses DATABASE_URL from .env.local; the key goes to docs/private/agent-key.txt)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "@/db/client";
import { agentKeys, mandates, paymentMethods, users } from "@/db/schema";
import { revokeMandate } from "@/lib/payments/service";
import { createPayPalClient } from "@/lib/paypal/client";
import { createPayeeClients, payeeCredentialsFromEnv } from "@/lib/paypal/payees";
import { storeConfirmedMandate } from "@/lib/mandates";
import { DEMO_STATEMENT, demoPolicy } from "@/lib/demo";
import { demoShops } from "@/lib/shops";
import { issueAgentKey } from "@/mcp/keys";

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

const shops = demoShops(process.env);
if (shops.length !== 3) throw new Error("PAYPAL_SHOP_{A,B,C}_MERCHANT_ID must all be set in .env.local");
const policy = demoPolicy(shops);

const { db, pool } = createDb(need("DATABASE_URL"), { max: 2 });
try {
  const email = "demo-shopper@example.com";
  let [user] = await db.select().from(users).where(eq(users.email, email));
  user ??= (await db.insert(users).values({ email, displayName: "Demo shopper" }).returning())[0]!;
  await db
    .insert(paymentMethods)
    .values({ userId: user.id, paypalPaymentTokenId: vaultId, paypalCustomerId: state.customerId ?? null })
    .onConflictDoNothing();

  // Retire earlier demo mandates the proper way, so any open hold is voided and their agent keys stop working.
  const deps = {
    db,
    platform: createPayPalClient({ clientId: need("PAYPAL_CLIENT_ID"), clientSecret: need("PAYPAL_CLIENT_SECRET") }),
    payees: createPayeeClients(payeeCredentialsFromEnv(process.env)),
  };
  const previous = await db
    .select({ id: mandates.id })
    .from(mandates)
    .where(and(eq(mandates.userId, user.id), eq(mandates.status, "active")));
  for (const { id } of previous) {
    const r = await revokeMandate(deps, id);
    await db.update(agentKeys).set({ revokedAt: new Date() }).where(and(eq(agentKeys.mandateId, id), isNull(agentKeys.revokedAt)));
    console.log(`revoked earlier mandate ${id} (${r.voided.length} holds released)`);
  }

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
