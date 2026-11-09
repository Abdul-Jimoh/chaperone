import { createPayPalClient } from "@/lib/paypal/client";
import { createPayeeClients } from "@/lib/paypal/payees";

type Auth = { id: string; status: string; amount: { currency_code: string; value: string }; payee: string };
// "network": the connection drops before PayPal acts. "lost": PayPal acts, then the response never arrives.
type Failure = { status: number; name: string; issue: string } | "network" | "lost";

/**
 * Enough of the PayPal sandbox to run the payment service: orders with vault holds, capture by the
 * platform, void only by the payee's own app (F2, F5), and request-id dedupe.
 */
export function fakePayPal(shopApps: Record<string, string>) {
  const auths = new Map<string, Auth>();
  const responses = new Map<string, unknown>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders = new Map<string, { authId: string; body: any }>();
  const captureIds = new Map<string, string>();
  const calls: { op: string; caller: string; body?: unknown; requestId?: string | null }[] = [];
  const fail: Partial<Record<"order" | "capture" | "void", Failure>> = {};
  let counter = 0;
  let payeeOverride: string | undefined;
  let omitPayee = false;
  let gate: Promise<void> | undefined;
  const setupTokens = new Set<string>();
  let onOrder: (() => void) | undefined;

  const error = (f: Failure) => {
    // The connection drops after PayPal may already have acted: the caller can't tell which.
    if (f === "network" || f === "lost") throw new TypeError("fetch failed");
    return Response.json({ name: f.name, details: [{ issue: f.issue }], debug_id: "dbg" }, { status: f.status });
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname === "/v1/oauth2/token") {
      const clientId = Buffer.from(headers.get("authorization")!.slice(6), "base64").toString().split(":")[0];
      return Response.json({ access_token: `token-${clientId}`, expires_in: 3600 });
    }
    const caller = headers.get("authorization")!.replace("Bearer token-", "");
    const requestId = headers.get("paypal-request-id");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (requestId && responses.has(requestId)) return Response.json(responses.get(requestId));

    if (url.pathname === "/v3/vault/setup-tokens" && init?.method === "POST") {
      const setup = { id: `ST-${setupTokens.size + 1}`, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "approve", href: "https://sandbox.paypal.test/approve" }] };
      setupTokens.add(setup.id);
      calls.push({ op: "setup", caller, body, requestId });
      responses.set(requestId!, setup);
      return Response.json(setup);
    }
    if (url.pathname === "/v3/vault/payment-tokens" && init?.method === "POST") {
      calls.push({ op: "vault", caller, body, requestId });
      const setupId = body?.payment_source?.token?.id;
      if (!setupTokens.has(setupId)) return error({ status: 404, name: "RESOURCE_NOT_FOUND", issue: "INVALID_RESOURCE_ID" });
      const token = { id: `PT-${setupId}`, customer: { id: "CUST-1" }, payment_source: { paypal: { email_address: "buyer@example.test" } }, links: [] };
      responses.set(requestId!, token);
      return Response.json(token);
    }
    const orderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (orderMatch && (!init?.method || init.method === "GET")) {
      const order = orders.get(orderMatch[1]!);
      if (!order) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
      const auth = auths.get(order.authId)!;
      return Response.json({
        ...order.body,
        purchase_units: [
          {
            ...order.body.purchase_units[0],
            payments: {
              authorizations: [{ id: auth.id, status: auth.status, amount: auth.amount }],
              ...(captureIds.has(auth.id) ? { captures: [{ id: captureIds.get(auth.id), status: "COMPLETED", amount: auth.amount }] } : {}),
            },
          },
        ],
      });
    }
    if (url.pathname === "/v2/checkout/orders" && init?.method === "POST") {
      calls.push({ op: "order", caller, body, requestId });
      onOrder?.();
      if (gate) await gate;
      if (fail.order && fail.order !== "lost") return error(fail.order);
      const unit = body.purchase_units[0];
      const auth: Auth = {
        id: `AUTH${++counter}`,
        status: "CREATED",
        amount: unit.amount,
        payee: payeeOverride ?? unit.payee.merchant_id,
      };
      auths.set(auth.id, auth);
      const order = {
        id: `ORDER${counter}`,
        status: "COMPLETED",
        intent: "AUTHORIZE",
        purchase_units: [
          {
            ...unit,
            payee: omitPayee ? undefined : { merchant_id: auth.payee },
            payments: { authorizations: [{ id: auth.id, status: auth.status, amount: auth.amount, expiration_time: "2026-12-01T00:00:00Z" }] },
          },
        ],
      };
      responses.set(requestId!, order);
      orders.set(order.id, { authId: auth.id, body: order });
      if (fail.order === "lost") return error("lost");
      return Response.json(order);
    }

    const match = url.pathname.match(/^\/v2\/payments\/authorizations\/([^/]+)(\/capture|\/void)?$/);
    const auth = match && auths.get(match[1]!);
    if (!auth) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    const view = () => ({ id: auth.id, status: auth.status, amount: auth.amount, payee: { merchant_id: auth.payee } });

    if (!match[2]) return Response.json(view());
    if (match[2] === "/capture") {
      calls.push({ op: "capture", caller, requestId });
      if (fail.capture && fail.capture !== "lost") return error(fail.capture);
      if (auth.status !== "CREATED") return error({ status: 422, name: "UNPROCESSABLE_ENTITY", issue: "AUTHORIZATION_ALREADY_CAPTURED" });
      auth.status = "CAPTURED";
      const capture = { id: `CAP-${auth.id}`, status: "COMPLETED", amount: auth.amount, final_capture: true };
      captureIds.set(auth.id, capture.id);
      responses.set(requestId!, capture);
      if (fail.capture === "lost") return error("lost");
      return Response.json(capture);
    }
    calls.push({ op: "void", caller, requestId });
    if (fail.void) return error(fail.void);
    if (shopApps[caller] !== auth.payee) return error({ status: 403, name: "PERMISSION_DENIED", issue: "PERMISSION_DENIED" });
    if (auth.status !== "CREATED") return error({ status: 422, name: "UNPROCESSABLE_ENTITY", issue: "CANNOT_BE_VOIDED" });
    auth.status = "VOIDED";
    responses.set(requestId!, view());
    return Response.json(view());
  };

  const platform = createPayPalClient({ clientId: "platform-app", clientSecret: "x", fetch });
  const payees = createPayeeClients(
    Object.fromEntries(Object.entries(shopApps).map(([app, merchant]) => [merchant, { clientId: app, clientSecret: "x" }])),
    { fetch },
  );

  return {
    platform,
    payees,
    calls,
    fail,
    auths,
    ops: () => calls.map((c) => `${c.op}:${c.caller}`),
    /** PayPal stops recognising earlier PayPal-Request-Ids (they are kept only for a while), so a retry is a new request. */
    forgetRequestIds() {
      responses.clear();
    },
    /** PayPal reports a different payee than requested, as a compromised or buggy path would. */
    reportPayee(merchantId: string) {
      payeeOverride = merchantId;
    },
    /** The order comes back without a payee, so it can't be checked. */
    omitPayee() {
      omitPayee = true;
    },
    /** Holds the next order request until `release` is called, to stage races. */
    holdOrders() {
      let release!: () => void;
      let started!: () => void;
      gate = new Promise<void>((r) => (release = r));
      const orderStarted = new Promise<void>((r) => (started = r));
      onOrder = started;
      return {
        orderStarted,
        release: () => {
          gate = undefined;
          onOrder = undefined;
          release();
        },
      };
    },
  };
}
