import { canonicalJson, sha256Hex } from "@/lib/policy/canonical";
import type { Cart } from "@/lib/policy/schema";
import { localDate } from "@/lib/policy/windows";

export type PayPalOperation = "order" | "authorize" | "capture" | "void" | "reauthorize";

/**
 * Derived from what is being bought, never from the request, so a retried or duplicated agent call
 * maps to the same key and PayPal dedupes it. Item order doesn't matter.
 *
 * `scope` separates legitimate repeat purchases: the run id (an in-app run, or an MCP agent's day: mcpRunId); for
 * direct calls without one, the UTC date. A cart whose hold was voided can be bought again (decideAndReserve).
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

/**
 * An agent connected over MCP has no runs of its own, so its run is the day in the rules' time zone: "$80 a run"
 * then caps everything MCP agents spend under this mandate that day, instead of each request on its own.
 */
export function mcpRunId(mandateId: string, now: Date, timeZone: string): string {
  return `mcp:${mandateId}:${localDate(now, timeZone)}`;
}

/** One PayPal-Request-Id per operation on the same cart, so capture and void retries are deduped too. */
export function paypalRequestId(key: string, op: PayPalOperation): string {
  return `${key}:${op}`;
}
