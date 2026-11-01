import type { PayPalClient } from "./client";

export type Link = { href: string; rel: string; method?: string };

export type SetupToken = {
  id: string;
  status: string;
  customer?: { id: string };
  links: Link[];
};

export type PaymentToken = {
  id: string;
  customer: { id: string };
  payment_source: { paypal?: { email_address?: string; payer_id?: string; name?: { given_name?: string; surname?: string } } };
  links: Link[];
};

export async function createPayPalSetupToken(
  client: PayPalClient,
  input: { returnUrl: string; cancelUrl: string; customerId?: string; requestId: string },
): Promise<SetupToken> {
  const { data } = await client.request<SetupToken>("/v3/vault/setup-tokens", {
    method: "POST",
    requestId: input.requestId,
    body: {
      ...(input.customerId ? { customer: { id: input.customerId } } : {}),
      payment_source: {
        paypal: {
          description: "Chaperone pays shops for you, only within the mandates you approve.",
          permit_multiple_payment_tokens: false,
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            brand_name: "Chaperone",
            locale: "en-US",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  return data;
}

export function approveLink(token: { links: Link[] }): string | undefined {
  return token.links.find((l) => l.rel === "approve")?.href;
}

export async function createPaymentTokenFromSetupToken(
  client: PayPalClient,
  setupTokenId: string,
  requestId: string,
): Promise<PaymentToken> {
  const { data } = await client.request<PaymentToken>("/v3/vault/payment-tokens", {
    method: "POST",
    requestId,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return data;
}

export async function deletePaymentToken(client: PayPalClient, paymentTokenId: string, requestId: string) {
  await client.request(`/v3/vault/payment-tokens/${encodeURIComponent(paymentTokenId)}`, { method: "DELETE", requestId });
}
