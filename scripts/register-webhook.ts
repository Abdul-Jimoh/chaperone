// Registers (or finds) the PayPal webhook on Chaperone's sandbox app and records its id in .env.local.
// pnpm tsx scripts/register-webhook.ts https://www.chaperone.site/api/webhooks/paypal
import { readFileSync, writeFileSync } from "node:fs";
import { createPayPalClient } from "@/lib/paypal/client";

process.loadEnvFile(".env.local");
const url = process.argv[2];
if (!url?.startsWith("https://")) throw new Error("usage: register-webhook.ts <https url of /api/webhooks/paypal>");

const EVENTS = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
];

type Webhook = { id: string; url: string; event_types: { name: string }[] };

const paypal = createPayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET! });
const { data: existing } = await paypal.request<{ webhooks: Webhook[] }>("/v1/notifications/webhooks");
let hook = existing.webhooks.find((w) => w.url === url);
if (hook) {
  console.log(`already registered: ${hook.id}`);
} else {
  hook = (
    await paypal.request<Webhook>("/v1/notifications/webhooks", {
      method: "POST",
      requestId: `register-webhook:${url}`,
      body: { url, event_types: EVENTS.map((name) => ({ name })) },
    })
  ).data;
  console.log(`registered: ${hook.id}`);
}
console.log(`events: ${hook.event_types.map((e) => e.name).join(", ")}`);

const envFile = readFileSync(".env.local", "utf8");
const line = `PAYPAL_WEBHOOK_ID=${hook.id}`;
writeFileSync(".env.local", /^PAYPAL_WEBHOOK_ID=.*$/m.test(envFile) ? envFile.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, line) : `${envFile.trimEnd()}\n${line}\n`);
console.log("PAYPAL_WEBHOOK_ID written to .env.local");
