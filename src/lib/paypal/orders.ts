import type { CartItem } from "@/lib/policy/schema";
import type { PayPalClient } from "./client";
import { money, type Money } from "./money";

export type Authorization = {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING" | string;
  amount: Money;
  payee?: { merchant_id?: string; email_address?: string };
  invoice_id?: string;
  custom_id?: string;
  expiration_time?: string;
  create_time?: string;
};

export type Order = {
  id: string;
  status: string;
  intent: string;
  purchase_units: {
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: { authorizations?: Authorization[]; captures?: { id: string; status: string }[] };
  }[];
  links?: { href: string; rel: string }[];
};

export type AuthorizeOrderInput = {
  vaultId: string;
  payeeMerchantId: string;
  currency: string;
  items: CartItem[];
  shippingCents: number;
  taxCents: number;
  /** Our payment id. Comes back on webhooks and in Transaction Search, so every PayPal record maps to a ledger row. */
  paymentId: string;
  requestId: string;
};

/** Buyer-not-present: the vaulted wallet is charged with a hold, no redirect, no buyer interaction. */
export async function createAuthorizeOrder(client: PayPalClient, input: AuthorizeOrderInput): Promise<Order> {
  const itemTotal = input.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const total = itemTotal + input.shippingCents + input.taxCents;
  const { data } = await client.request<Order>("/v2/checkout/orders", {
    method: "POST",
    requestId: input.requestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.paymentId,
          custom_id: input.paymentId,
          invoice_id: input.paymentId,
          payee: { merchant_id: input.payeeMerchantId },
          amount: {
            ...money(total, input.currency),
            breakdown: {
              item_total: money(itemTotal, input.currency),
              shipping: money(input.shippingCents, input.currency),
              tax_total: money(input.taxCents, input.currency),
            },
          },
          items: input.items.map((i) => ({
            name: i.title.slice(0, 127),
            sku: i.productId?.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: money(i.unitPriceCents, input.currency),
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: { paypal: { vault_id: input.vaultId } },
    },
  });
  return data;
}

export async function getOrder(client: PayPalClient, orderId: string): Promise<Order> {
  return (await client.request<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`)).data;
}

export function firstAuthorization(order: Order): Authorization | undefined {
  return order.purchase_units[0]?.payments?.authorizations?.[0];
}
