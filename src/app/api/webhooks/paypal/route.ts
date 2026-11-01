import { requireEnv } from "@/lib/env";
import { applyWebhookEvent } from "@/lib/payments/webhooks";
import { readWebhookHeaders, verifyWebhook, WebhookVerificationError } from "@/lib/paypal/webhooks";
import { paypalCertLoader, serverDb, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withConfigCheck(async (request: Request): Promise<Response> => {
  // The signature covers the exact bytes PayPal sent, so read the body as text before any parsing.
  const rawBody = await request.text();
  let event;
  try {
    event = await verifyWebhook({
      rawBody,
      headers: readWebhookHeaders(request.headers),
      webhookId: requireEnv("PAYPAL_WEBHOOK_ID"),
      loadCert: paypalCertLoader,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError || error instanceof SyntaxError) {
      // Unverified payloads are not stored: anyone can POST here.
      console.warn("paypal webhook rejected:", error.message);
      return Response.json({ error: "invalid webhook" }, { status: 400 });
    }
    throw error;
  }

  // A thrown error rolls the event back and returns 500, so PayPal redelivers it.
  const outcome = await applyWebhookEvent(serverDb(), event);
  return Response.json({ outcome });
});
