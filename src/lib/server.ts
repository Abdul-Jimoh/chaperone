import "server-only";
import { createDb, type Db } from "@/db/client";
import { ConfigError, env, requireEnv } from "@/lib/env";
import type { ApprovalDeps } from "@/lib/payments/approvals";
import { createPayPalClient } from "@/lib/paypal/client";
import { createPayeeClients, payeeCredentialsFromEnv } from "@/lib/paypal/payees";
import { httpsCertLoader } from "@/lib/paypal/webhooks";

// Module scope survives between invocations of a warm serverless function, so pools and tokens are reused.
let db: Db | undefined;
let deps: ApprovalDeps | undefined;

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
