const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  /** How long a call may take before it counts as no answer (default 15 s). */
  timeoutMs?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type PayPalErrorBody = {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
};

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly body: PayPalErrorBody,
    readonly debugId: string | undefined,
  ) {
    const issue = body.details?.[0]?.issue;
    super(`PayPal ${status} ${body.name ?? ""}${issue ? ` (${issue})` : ""}: ${body.message ?? "request failed"}`);
  }

  get issue(): string | undefined {
    return this.body.details?.[0]?.issue;
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Required on every mutating call; PayPal uses it to dedupe retries. */
  requestId?: string;
  headers?: Record<string, string>;
};

export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** The scopes PayPal gives a client SDK token (observed 2026-11-09); with it, the Orders and reporting APIs answer 403. */
const CLIENT_SDK_SCOPES = new Set([
  "https://uri.paypal.com/services/vault/payment-tokens/read",
  "Braintree:Vault",
  "https://uri.paypal.com/services/subscriptions/confirm-payment",
  "https://uri.paypal.com/services/payments/orders/client_sdk_orders_api",
  "https://uri.paypal.com/services/payments/client-payments-eligibility",
  "https://uri.paypal.com/services/credit/client-offer-presentment/read",
]);

/** A PayPal call that takes longer fails as "no answer" and is resumed later, rather than holding up an agent's call. */
const TIMEOUT_MS = 15_000;

export function createPayPalClient(config: PayPalConfig) {
  const baseUrl = config.baseUrl ?? SANDBOX_BASE;
  const doFetch = config.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | undefined;

  async function oauthToken(body: string): Promise<{ value: string; expiresAt: number; scope: string }> {
    const res = await doFetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string } & PayPalErrorBody;
    if (!res.ok || !json.access_token) {
      throw new PayPalError(res.status, json, res.headers.get("paypal-debug-id") ?? undefined);
    }
    return { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000, scope: json.scope ?? "" };
  }

  async function accessToken(): Promise<string> {
    // Refresh a minute early so a token never expires mid-request.
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value;
    token = await oauthToken("grant_type=client_credentials");
    return token.value;
  }

  const browser = new Map<string, { value: string; expiresAt: number }>();

  /**
   * A browser-safe token for the JS SDK v6, bound to the app's domains. It goes to every visitor, so it is refused unless
   * PayPal scoped it to the client SDK: a full REST token here would let anyone move money as the platform.
   */
  async function browserToken(domains: string[]): Promise<string> {
    const key = domains.join(" ");
    const cached = browser.get(key);
    if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.value;
    const params = new URLSearchParams({ grant_type: "client_credentials", response_type: "client_token", intent: "sdk_init" });
    for (const d of domains) params.append("domains[]", d);
    const token = await oauthToken(params.toString());
    const scopes = token.scope.split(" ").filter(Boolean);
    if (!scopes.length || !scopes.every((s) => CLIENT_SDK_SCOPES.has(s))) throw new Error("PayPal returned a token that isn't a client SDK token");
    browser.set(key, token);
    return token.value;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; debugId?: string }> {
    const method = options.method ?? "GET";
    if (method !== "GET" && !options.requestId) {
      throw new Error(`PayPal ${method} ${path} needs a PayPal-Request-Id`);
    }
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.requestId ? { "PayPal-Request-Id": options.requestId } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS),
    });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(res.status, json, debugId ?? json.debug_id);
    return { data: json as T, debugId };
  }

  return { request, accessToken, browserToken };
}
