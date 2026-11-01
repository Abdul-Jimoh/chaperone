import { canonicalJson, sha256Hex } from "@/lib/policy/canonical";
import type { Cart } from "@/lib/policy/schema";

export type PayPalOperation = "order" | "authorize" | "capture" | "void" | "reauthorize";

/**
 * Derived from what is being bought, never from the request, so a retried or duplicated agent call
 * maps to the same key and PayPal dedupes it. Item order doesn't matter.
 *
 * `scope` separates legitimate repeat purchases: the run id for scheduled runs; for ad-hoc
 * (e.g. MCP) requests without one, the UTC date, so an identical cart re-sent the same day is the same purchase.
 */
export function cartIdempotencyKey(input: { mandateId: string; cart: Cart; runId: string | null; now: Date }): string {
  const { mandateId, cart, runId, now } = input;
  const items = cart.items
    .map((i) => canonicalJson({ p: i.productId ?? null, t: i.title, u: i.unitPriceCents, q: i.quantity }))
    .sort();
  const scope = runId ?? `day:${now.toISOString().slice(0, 10)}`;
  const material = canonicalJson({
    m: mandateId,
    s: scope,
    payee: cart.payeeMerchantId,
    cur: cart.currency,
    items,
    ship: cart.shippingCents,
    tax: cart.taxCents,
  });
  return `chp_${sha256Hex(material)}`;
}

/** One PayPal-Request-Id per operation on the same cart, so capture and void retries are deduped too. */
export function paypalRequestId(key: string, op: PayPalOperation): string {
  return `${key}:${op}`;
}
