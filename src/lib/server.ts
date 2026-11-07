import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createDb, type Db } from "@/db/client";
import { ConfigError, env, requireEnv } from "@/lib/env";
import type { DemoWorld } from "@/lib/app/demo";
import type { ApprovalDeps } from "@/lib/payments/approvals";
import { createPayPalClient } from "@/lib/paypal/client";
import { createPayeeClients, payeeCredentialsFromEnv } from "@/lib/paypal/payees";
import { httpsCertLoader } from "@/lib/paypal/webhooks";
import { demoShops } from "@/lib/shops";
import { catalogSearch, demoCatalog } from "@/lib/catalog";
import { createLlm, type Llm } from "@/lib/llm/llm";
import { liveTransport, type Transport } from "@/lib/llm/transport";
import { aiChecks, enforce } from "@/lib/ratelimit";

// Module scope survives between invocations of a warm serverless function, so pools and tokens are reused.
let db: Db | undefined;
let deps: ApprovalDeps | undefined;
let anthropic: Anthropic | undefined;

export function serverDb(): Db {
  db ??= createDb(requireEnv("DATABASE_URL"), { max: 3 }).db;
  return db;
}

export function paymentDeps(): ApprovalDeps {
  deps ??= {
    db: serverDb(),
    platform: createPayPalClient({ clientId: requireEnv("PAYPAL_CLIENT_ID"), clientSecret: requireEnv("PAYPAL_CLIENT_SECRET") }),
    payees: createPayeeClients(payeeCredentialsFromEnv(env())),
    approvalSecret: requireEnv("APPROVAL_LINK_SECRET"),
  };
  return deps;
}

export const paypalCertLoader = httpsCertLoader();

// Created on the first cache miss, so cached replies still work on a deployment without an API key.
const claude: Transport = (params, purpose) => {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw new ConfigError("Missing env var ANTHROPIC_API_KEY.");
  anthropic ??= new Anthropic({ apiKey });
  return liveTransport(anthropic)(params, purpose);
};

/** Kept back from the public demo for development and recording the video. */
const RESERVED_USD = 0.3;

/**
 * Claude for the public app, working for one shopper. Identical requests replay from the cache for free; a call that
 * reaches Claude counts against the shopper's visitor and the demo's daily caps, and stops RESERVED_USD short of the
 * project's budget.
 */
export function serverLlm(userId: string): Llm {
  const db = serverDb();
  return createLlm({
    db,
    transport: claude,
    budgetUsd: Math.max(0, env().LLM_BUDGET_USD - RESERVED_USD),
    cache: true,
    sessionId: userId,
    beforeLive: async () => enforce(db, await aiChecks(db, userId)),
  });
}

export function demoSearch() {
  const world = demoWorld();
  return catalogSearch(demoCatalog(world.shops, world.rogueMerchantId));
}

/** The demo's shops and the merchant used as the "wrong shop" in the injected-listing cart. */
export function demoWorld(): DemoWorld {
  const shops = demoShops(env());
  if (shops.length !== 3) throw new ConfigError("Missing env var PAYPAL_SHOP_{A,B,C}_MERCHANT_ID. See .env.example.");
  return { shops, rogueMerchantId: env().PAYPAL_ROGUE_MERCHANT_ID ?? "ROGUEMERCHANT1" };
}

/** Answers 503 naming the missing setting instead of an opaque 500, so a misconfigured deploy is obvious. */
export function withConfigCheck(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      console.error(error.message);
      return Response.json({ error: "server not configured", detail: error.message }, { status: 503 });
    }
  };
}
