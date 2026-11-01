import type { PayPalClient } from "./client";
import { money, type Money } from "./money";
import type { Authorization } from "./orders";

export type Capture = { id: string; status: string; amount: Money; final_capture?: boolean };

const path = (id: string, action = "") => `/v2/payments/authorizations/${encodeURIComponent(id)}${action}`;

export async function getAuthorization(client: PayPalClient, authorizationId: string): Promise<Authorization> {
  return (await client.request<Authorization>(path(authorizationId))).data;
}

export async function captureAuthorization(
  client: PayPalClient,
  authorizationId: string,
  input: { requestId: string; invoiceId?: string },
): Promise<Capture> {
  const { data } = await client.request<Capture>(path(authorizationId, "/capture"), {
    method: "POST",
    requestId: input.requestId,
    body: { final_capture: true, ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}) },
  });
  return data;
}

export async function voidAuthorization(client: PayPalClient, authorizationId: string, requestId: string): Promise<Authorization | null> {
  const { data } = await client.request<Authorization | Record<string, never>>(path(authorizationId, "/void"), {
    method: "POST",
    requestId,
  });
  return "id" in data ? (data as Authorization) : null;
}

export async function reauthorize(
  client: PayPalClient,
  authorizationId: string,
  input: { amountCents: number; currency: string; requestId: string },
): Promise<Authorization> {
  const { data } = await client.request<Authorization>(path(authorizationId, "/reauthorize"), {
    method: "POST",
    requestId: input.requestId,
    body: { amount: money(input.amountCents, input.currency) },
  });
  return data;
}
