import { createSign, generateKeyPairSync } from "node:crypto";
import { crc32 } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerEvents, payments, reservations, webhookEvents } from "@/db/schema";
import { requestPayment, type PaymentDeps } from "@/lib/payments/service";
import { applyWebhookEvent } from "@/lib/payments/webhooks";
import { assertPayPalCertUrl, verifyWebhook, WebhookVerificationError, type WebhookHeaders } from "@/lib/paypal/webhooks";
import { fakePayPal } from "./support/fake-paypal";
import { resetDb, seedLinkedMandate, testDb } from "./support/db";
import { cart, SHOP_A, SHOP_B, samplePolicy } from "./support/fixtures";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WEBHOOK_ID = "WH-TEST-123";
const now = new Date("2026-11-03T15:00:00Z");

function signed(body: object, overrides: Partial<WebhookHeaders> = {}, webhookId = WEBHOOK_ID) {
  const rawBody = JSON.stringify(body);
  const headers: WebhookHeaders = {
    transmissionId: "tx-1",
    transmissionTime: now.toISOString(),
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    authAlgo: "SHA256withRSA",
    transmissionSig: "",
    ...overrides,
  };
  const message = `${headers.transmissionId}|${headers.transmissionTime}|${webhookId}|${crc32(Buffer.from(rawBody))}`;
  headers.transmissionSig = overrides.transmissionSig ?? createSign("SHA256").update(message).sign(privateKey, "base64");
  return { rawBody, headers };
}

const verify = (input: { rawBody: string; headers: WebhookHeaders }) =>
  verifyWebhook({ ...input, webhookId: WEBHOOK_ID, loadCert: async () => publicKey, now });

const event = { id: "WH-EVT-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-1", status: "COMPLETED" } };

describe("verifyWebhook", () => {
  it("accepts an event signed over PayPal's message format", async () => {
    expect(await verify(signed(event))).toEqual(event);
  });

  it("rejects a body changed after signing", async () => {
    const s = signed(event);
    await expect(verify({ ...s, rawBody: s.rawBody.replace("COMPLETED", "REFUNDED") })).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects an event signed for a different webhook subscription", async () => {
    await expect(verify(signed(event, {}, "WH-SOMEONE-ELSE"))).rejects.toThrow("signature");
  });

  it("rejects a stale transmission", async () => {
    const old = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    await expect(verify(signed(event, { transmissionTime: old }))).rejects.toThrow("too old");
  });

  it("only fetches signing certificates from PayPal over HTTPS", () => {
    for (const bad of [
      "http://api.sandbox.paypal.com/cert",
      "https://api.sandbox.paypal.com.evil.example/cert",
      "https://evil.example/api.paypal.com",
      "https://api.paypal.com:8443/cert",
      "not a url",
    ]) {
      expect(() => assertPayPalCertUrl(bad), bad).toThrow(WebhookVerificationError);
    }
    expect(assertPayPalCertUrl("https://api.paypal.com/v1/notifications/certs/X").hostname).toBe("api.paypal.com");
  });
});

describe("applyWebhookEvent", () => {
  const { db, pool } = testDb(10);
  afterAll(() => pool.end());
  beforeEach(() => resetDb(db));

  async function heldPayment(input: { cart?: ReturnType<typeof cart>; failCapture?: boolean } = {}) {
    const paypal = fakePayPal({ "shop-a-app": SHOP_A, "shop-b-app": SHOP_B });
    const deps: PaymentDeps = { db, platform: paypal.platform, payees: paypal.payees, clock: () => now };
    if (input.failCapture) paypal.fail.capture = { status: 422, name: "UNPROCESSABLE_ENTITY", issue: "INSTRUMENT_DECLINED" };
    const mandate = await seedLinkedMandate(db, samplePolicy());
    const result = await requestPayment(deps, { mandateId: mandate.id, runId: "run-1", source: "agent", cart: input.cart ?? cart() });
    if (!result.ok) throw new Error("no payment");
    return result.payment;
  }

  const captureEvent = (paymentId: string, authId: string, id = "WH-1") => ({
    id,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: `CAP-${authId}`,
      status: "COMPLETED",
      custom_id: paymentId,
      supplementary_data: { related_ids: { authorization_id: authId } },
    },
  });

  it("completes a capture whose response the service never saw, once", async () => {
    const payment = await heldPayment({ failCapture: true });
    // As if the process died after PayPal captured but before the ledger was updated.
    await db.update(payments).set({ status: "capturing" }).where(eq(payments.id, payment.id));

    const evt = captureEvent(payment.id, payment.paypalAuthorizationId!);
    expect(await applyWebhookEvent(db, evt, now)).toBe("applied");
    expect(await applyWebhookEvent(db, evt, now)).toBe("duplicate");

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: "captured", paypalCaptureId: `CAP-${payment.paypalAuthorizationId}` });
    expect((await db.select().from(reservations))[0]!.status).toBe("captured");
    const logged = (await db.select().from(ledgerEvents)).filter((e) => e.type.startsWith("paypal."));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.mandateHash).toBe(payment.mandateHash);
  });

  it("frees the budget when PayPal voids a hold on its own", async () => {
    const big = cart({ payeeMerchantId: SHOP_B, items: [{ title: "Dog food, 12 kg", unitPriceCents: 5_000, quantity: 1, category: "dog-food" }] });
    const payment = await heldPayment({ cart: big });
    expect(payment.status).toBe("pending_approval");
    const voided = {
      id: "WH-2",
      event_type: "PAYMENT.AUTHORIZATION.VOIDED",
      resource: { id: payment.paypalAuthorizationId!, status: "VOIDED", custom_id: payment.id },
    };
    expect(await applyWebhookEvent(db, voided, now)).toBe("applied");
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("voided");
    expect((await db.select().from(reservations))[0]!.status).toBe("released");
  });

  it("frees the budget of a hold whose capture never got an answer, when PayPal voids it", async () => {
    const payment = await heldPayment({ failCapture: true });
    await db.update(payments).set({ status: "capturing" }).where(eq(payments.id, payment.id));
    const voided = {
      id: "WH-3",
      event_type: "PAYMENT.AUTHORIZATION.VOIDED",
      resource: { id: payment.paypalAuthorizationId!, status: "VOIDED", custom_id: payment.id },
    };
    expect(await applyWebhookEvent(db, voided, now)).toBe("applied");
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("voided");
    expect((await db.select().from(reservations))[0]!.status).toBe("released");
  });

  it("flags a capture that didn't come through the payment service", async () => {
    const payment = await heldPayment({ failCapture: true });
    expect(payment.status).toBe("authorized");
    await applyWebhookEvent(db, captureEvent(payment.id, payment.paypalAuthorizationId!), now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: "captured", anomalyFlags: ["unexpected_capture"] });
  });

  it("ignores an event whose payment id and authorization disagree", async () => {
    const payment = await heldPayment({ failCapture: true });
    expect(await applyWebhookEvent(db, captureEvent(payment.id, "AUTH-OTHER"), now)).toBe("unmatched");
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe("authorized");
  });

  it("stores events for payments it doesn't know without touching the ledger", async () => {
    const outcome = await applyWebhookEvent(db, { id: "WH-3", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-X" } }, now);
    expect(outcome).toBe("unmatched");
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
    expect(await db.select().from(ledgerEvents)).toEqual([]);
  });
});
