const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
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

export function createPayPalClient(config: PayPalConfig) {
  const baseUrl = config.baseUrl ?? SANDBOX_BASE;
  const doFetch = config.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    // Refresh a minute early so a token never expires mid-request.
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value;
    const res = await doFetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number } & PayPalErrorBody;
    if (!res.ok || !json.access_token) {
      throw new PayPalError(res.status, json, res.headers.get("paypal-debug-id") ?? undefined);
    }
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000 };
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
    });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(res.status, json, debugId ?? json.debug_id);
    return { data: json as T, debugId };
  }

  return { request, accessToken };
}
