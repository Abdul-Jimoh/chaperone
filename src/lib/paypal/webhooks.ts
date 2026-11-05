import { createVerify, X509Certificate, type KeyObject } from "node:crypto";
import { crc32 } from "node:zlib";

export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

export type WebhookEvent = {
  id: string;
  event_type: string;
  resource_type?: string;
  create_time?: string;
  resource: Record<string, unknown> & { id?: string };
};

export class WebhookVerificationError extends Error {}

const CERT_HOSTS = new Set(["api.paypal.com", "api.sandbox.paypal.com", "api-m.paypal.com", "api-m.sandbox.paypal.com"]);

// PayPal retries for days, but a captured request replayed long after must not be accepted again.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  const get = (name: string) => {
    const value = headers.get(name);
    if (!value) throw new WebhookVerificationError(`missing ${name}`);
    return value;
  };
  return {
    transmissionId: get("paypal-transmission-id"),
    transmissionTime: get("paypal-transmission-time"),
    transmissionSig: get("paypal-transmission-sig"),
    certUrl: get("paypal-cert-url"),
    authAlgo: get("paypal-auth-algo"),
  };
}

/**
 * The signing certificate's URL arrives in the request itself, so only PayPal's own HTTPS hosts are
 * trusted to serve it; otherwise anyone could sign events with their own key and point us at it.
 */
export function assertPayPalCertUrl(certUrl: string): URL {
  let url: URL;
  try {
    url = new URL(certUrl);
  } catch {
    throw new WebhookVerificationError("cert url is not a URL");
  }
  if (url.protocol !== "https:" || !CERT_HOSTS.has(url.hostname) || url.port !== "") {
    throw new WebhookVerificationError(`cert url host ${url.hostname} is not PayPal`);
  }
  return url;
}

export type CertLoader = (certUrl: URL, now: Date) => Promise<KeyObject>;

type Cert = Pick<X509Certificate, "validFrom" | "validTo" | "publicKey">;

export function httpsCertLoader(fetchImpl: typeof fetch = fetch, parse: (pem: string) => Cert = (pem) => new X509Certificate(pem)): CertLoader {
  const cache = new Map<string, Cert>();
  return async (certUrl, now) => {
    // Keyed without the query string and bounded: the URL comes from an unauthenticated request.
    const key = certUrl.origin + certUrl.pathname;
    let cert = cache.get(key);
    if (!cert) {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      const res = await fetchImpl(key, { redirect: "error" });
      if (!res.ok) throw new WebhookVerificationError(`cert fetch failed: ${res.status}`);
      cert = parse(await res.text());
      cache.set(key, cert);
    }
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      throw new WebhookVerificationError("signing certificate is not currently valid");
    }
    return cert.publicKey;
  };
}

/**
 * Self-verification as PayPal documents it: the signature covers
 * `transmissionId|transmissionTime|webhookId|crc32(rawBody)`, so the raw body must be used as received.
 * The webhook id ties the event to our own subscription.
 */
export async function verifyWebhook(input: {
  rawBody: string;
  headers: WebhookHeaders;
  webhookId: string;
  loadCert: CertLoader;
  now?: Date;
}): Promise<WebhookEvent> {
  const { rawBody, headers, webhookId } = input;
  const now = input.now ?? new Date();
  if (headers.authAlgo !== "SHA256withRSA") throw new WebhookVerificationError(`unsupported algorithm ${headers.authAlgo}`);

  const sentAt = Date.parse(headers.transmissionTime);
  if (Number.isNaN(sentAt) || Math.abs(now.getTime() - sentAt) > MAX_AGE_MS) {
    throw new WebhookVerificationError("transmission time is missing or too old");
  }

  const key = await input.loadCert(assertPayPalCertUrl(headers.certUrl), now);
  const message = `${headers.transmissionId}|${headers.transmissionTime}|${webhookId}|${crc32(Buffer.from(rawBody, "utf8"))}`;
  const valid = createVerify("SHA256").update(message).verify(key, headers.transmissionSig, "base64");
  if (!valid) throw new WebhookVerificationError("signature does not match");

  const event = JSON.parse(rawBody) as WebhookEvent;
  if (typeof event.id !== "string" || typeof event.event_type !== "string" || typeof event.resource !== "object") {
    throw new WebhookVerificationError("not a webhook event");
  }
  return event;
}
