import { createPayPalClient, type PayPalClient, type PayPalConfig } from "./client";
import { getAuthorization, voidAuthorization } from "./payments";
import type { Authorization } from "./orders";

export type PayeeCredentials = Record<string, { clientId: string; clientSecret: string }>;

type EnvLike = Partial<Record<string, string | undefined>>;

/** Shop credentials keyed by merchant ID. A shop with an ID but no app credentials is left out. */
export function payeeCredentialsFromEnv(env: EnvLike): PayeeCredentials {
  const creds: PayeeCredentials = {};
  for (const shop of ["A", "B", "C"]) {
    const merchantId = env[`PAYPAL_SHOP_${shop}_MERCHANT_ID`];
    const clientId = env[`PAYPAL_SHOP_${shop}_CLIENT_ID`];
    const clientSecret = env[`PAYPAL_SHOP_${shop}_CLIENT_SECRET`];
    if (merchantId && clientId && clientSecret) creds[merchantId] = { clientId, clientSecret };
  }
  return creds;
}

export class UnknownPayeeError extends Error {}
export class PayeeMismatchError extends Error {}

export type PayeeClients = ReturnType<typeof createPayeeClients>;

export function createPayeeClients(credentials: PayeeCredentials, base: Omit<PayPalConfig, "clientId" | "clientSecret"> = {}) {
  const clients = new Map<string, PayPalClient>();
  return {
    forPayee(merchantId: string): PayPalClient {
      const creds = credentials[merchantId];
      if (!creds) throw new UnknownPayeeError(`No PayPal app credentials for payee ${merchantId}`);
      let client = clients.get(merchantId);
      if (!client) {
        client = createPayPalClient({ ...base, ...creds });
        clients.set(merchantId, client);
      }
      return client;
    },
  };
}

/**
 * Releases a hold. PayPal lets only the payee void an authorization, so the payee is read from
 * PayPal's own record (not from anything the agent supplied) and must match the ledger before that
 * shop's credentials are used.
 */
export async function voidHold(input: {
  platform: PayPalClient;
  payees: PayeeClients;
  authorizationId: string;
  expectedPayeeMerchantId: string;
  requestId: string;
}): Promise<Authorization | null> {
  const auth = await getAuthorization(input.platform, input.authorizationId);
  const payee = auth.payee?.merchant_id;
  if (payee !== input.expectedPayeeMerchantId) {
    throw new PayeeMismatchError(
      `Authorization ${input.authorizationId} pays ${payee ?? "nobody"}, ledger expects ${input.expectedPayeeMerchantId}`,
    );
  }
  if (auth.status === "VOIDED") return auth;
  return voidAuthorization(input.payees.forPayee(payee), input.authorizationId, input.requestId);
}
