import { describe, expect, it } from "vitest";
import { cartIdempotencyKey, paypalRequestId } from "@/lib/ledger/idempotency";
import { cart } from "./support/fixtures";

const now = new Date("2026-11-03T15:00:00Z");
const twoItems = cart({
  items: [
    { productId: "a", title: "Coffee", unitPriceCents: 1_800, quantity: 1, category: "coffee" },
    { productId: "b", title: "Filters", unitPriceCents: 500, quantity: 2, category: "coffee" },
  ],
});

describe("cartIdempotencyKey", () => {
  const key = (c = twoItems, runId: string | null = "run-1", at = now) => cartIdempotencyKey({ mandateId: "m1", cart: c, runId, now: at });

  it("is the same for a retried request, whatever the item order", () => {
    expect(key()).toBe(key(cart({ ...twoItems, items: [...twoItems.items].reverse() })));
  });

  it("differs when anything about the purchase differs", () => {
    expect(key()).not.toBe(key(cart({ ...twoItems, items: [twoItems.items[0]!] })));
    expect(key()).not.toBe(key(cart({ ...twoItems, payeeMerchantId: "SHOPBBBBBBBBB" })));
    expect(key()).not.toBe(key(twoItems, "run-2"));
    expect(cartIdempotencyKey({ mandateId: "m2", cart: twoItems, runId: "run-1", now })).not.toBe(key());
  });

  it("scopes ad-hoc requests to the UTC day", () => {
    expect(key(twoItems, null)).toBe(key(twoItems, null, new Date("2026-11-03T23:59:59Z")));
    expect(key(twoItems, null)).not.toBe(key(twoItems, null, new Date("2026-11-04T00:00:00Z")));
  });

  it("gives each PayPal operation its own request id within PayPal's length limit", () => {
    expect(paypalRequestId(key(), "capture")).not.toBe(paypalRequestId(key(), "void"));
    expect(paypalRequestId(key(), "reauthorize").length).toBeLessThanOrEqual(108);
  });
});
