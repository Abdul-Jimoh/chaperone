// One command to get a local copy running: pnpm bootstrap
// Creates .env.local, generates the keys, sets up a local Postgres (unless DATABASE_URL points elsewhere), applies the
// migrations, checks the PayPal sandbox credentials against PayPal, and lists exactly what is still missing.
// Safe to run again: it never overwrites a value you set.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { Pool } from "pg";
import { isLocalUrl, LOCAL_URL, startLocalDb } from "./local-db";

const ENV = ".env.local";
const ok = (s: string) => console.log(`  ✓ ${s}`);
const todo: string[] = [];
const missing = (s: string) => {
  console.log(`  ✗ ${s}`);
  todo.push(s);
};

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error(`Node 22 or newer is needed (this is ${process.version}).`);
  process.exit(1);
}

console.log("\nSettings");
if (!existsSync(ENV)) {
  copyFileSync(".env.example", ENV);
  ok(`created ${ENV} from .env.example`);
}
let text = readFileSync(ENV, "utf8");
const read = () => {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
};
/** Sets a variable only if it is missing or empty; values the user set are left alone. */
const fill = (key: string, value: string, label: string) => {
  if (read()[key]) return ok(`${key} already set`);
  const line = `${key}=${value.includes(" ") || value.startsWith("{") ? `'${value}'` : value}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(ENV, text);
  ok(`${key}: ${label}`);
};

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), alg: "ES256" };
fill("MANDATE_SIGNING_JWK", JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) }), "generated an ES256 signing key");
fill("APPROVAL_LINK_SECRET", randomBytes(32).toString("base64url"), "generated");
fill("CRON_SECRET", randomBytes(32).toString("base64url"), "generated");
fill("DATABASE_URL", LOCAL_URL, "a local Postgres on this machine (no account needed)");
fill("DATABASE_URL_UNPOOLED", read().DATABASE_URL!, "same as DATABASE_URL");
const env = read();

console.log("\nDatabase");
const stop = isLocalUrl(env.DATABASE_URL) ? await startLocalDb() : null;
if (stop) ok(`local Postgres running from .local/pg`);
try {
  const pool = new Pool({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  ok("migrations applied");
} catch (error) {
  missing(`database: ${(error as Error).message}`);
} finally {
  await stop?.();
}

console.log("\nPayPal sandbox (developer.paypal.com → Testing Tools → Sandbox Accounts, and Apps & Credentials)");
async function credentials(label: string, id?: string, secret?: string) {
  if (!id || !secret) return missing(`${label}: client id and secret`);
  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).catch(() => null);
  if (res?.ok) ok(`${label}: PayPal accepted the credentials`);
  else missing(`${label}: PayPal refused the credentials (${res?.status ?? "no answer"})`);
}
await credentials("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, the platform app (enable Vault in its features)", env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET);
for (const shop of ["A", "B", "C"]) {
  const merchant = env[`PAYPAL_SHOP_${shop}_MERCHANT_ID`];
  if (merchant) ok(`PAYPAL_SHOP_${shop}_MERCHANT_ID set`);
  else missing(`PAYPAL_SHOP_${shop}_MERCHANT_ID: the merchant ID of a sandbox business account (its Account info)`);
  await credentials(`PAYPAL_SHOP_${shop}_CLIENT_ID / _SECRET, a REST app created while logged in as that business account (only the payee can void a hold)`, env[`PAYPAL_SHOP_${shop}_CLIENT_ID`], env[`PAYPAL_SHOP_${shop}_CLIENT_SECRET`]);
}
if (env.PAYPAL_ROGUE_MERCHANT_ID) ok("PAYPAL_ROGUE_MERCHANT_ID set");
else console.log("  · PAYPAL_ROGUE_MERCHANT_ID: optional, any other merchant ID; used as the shop in the tricked cart");

console.log("\nOptional");
console.log(env.ANTHROPIC_API_KEY ? "  ✓ ANTHROPIC_API_KEY set: Claude compiles your own sentences and runs the agent" : "  · ANTHROPIC_API_KEY: without it, setup offers the example rules as Claude compiled them earlier; the agent trip needs it");
console.log(env.PAYPAL_WEBHOOK_ID ? "  ✓ PAYPAL_WEBHOOK_ID set" : "  · PAYPAL_WEBHOOK_ID: webhooks need a public https URL; run scripts/register-webhook.ts once deployed. Payments work without them.");

console.log(todo.length ? `\n${todo.length} thing${todo.length > 1 ? "s" : ""} left to fill in ${ENV}, then run pnpm bootstrap again.` : "\nReady.");
console.log("Start the app: pnpm dev:local  (http://localhost:3000). In the app, link your sandbox personal account with PayPal's button.\n");
