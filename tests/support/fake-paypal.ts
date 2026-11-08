import { createPayPalClient } from "@/lib/paypal/client";
import { createPayeeClients } from "@/lib/paypal/payees";

type Auth = { id: string; status: string; amount: { currency_code: string; value: string }; payee: string };
type Failure = { status: number; name: string; issue: string } | "network";

/**
 * Enough of the PayPal sandbox to run the payment service: orders with vault holds, capture by the
 * platform, void only by the payee's own app (F2, F5), and request-id dedupe.
 */
export function fakePayPal(shopApps: Record<string, string>) {
  const auths = new Map<string, Auth>();
  const responses = new Map<string, unknown>();
  const calls: { op: string; caller: string; body?: unknown }[] = [];
  const fail: Partial<Record<"order" | "capture" | "void", Failure>> = {};
  let counter = 0;
  let payeeOverride: string | undefined;
  let gate: Promise<void> | undefined;
  let onOrder: (() => void) | undefined;

  const error = (f: Failure) => {
    // The connection drops after PayPal may already have acted: the caller can't tell which.
    if (f === "network") throw new TypeError("fetch failed");
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

    if (url.pathname === "/v2/checkout/orders" && init?.method === "POST") {
      calls.push({ op: "order", caller, body });
      onOrder?.();
      if (gate) await gate;
      if (fail.order) return error(fail.order);
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
            payee: { merchant_id: auth.payee },
            payments: { authorizations: [{ id: auth.id, status: auth.status, amount: auth.amount, expiration_time: "2026-12-01T00:00:00Z" }] },
          },
        ],
      };
      responses.set(requestId!, order);
      return Response.json(order);
    }

    const match = url.pathname.match(/^\/v2\/payments\/authorizations\/([^/]+)(\/capture|\/void)?$/);
    const auth = match && auths.get(match[1]!);
    if (!auth) return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    const view = () => ({ id: auth.id, status: auth.status, amount: auth.amount, payee: { merchant_id: auth.payee } });

    if (!match[2]) return Response.json(view());
    if (match[2] === "/capture") {
      calls.push({ op: "capture", caller });
      if (fail.capture) return error(fail.capture);
      if (auth.status !== "CREATED") return error({ status: 422, name: "UNPROCESSABLE_ENTITY", issue: "AUTHORIZATION_ALREADY_CAPTURED" });
      auth.status = "CAPTURED";
      const capture = { id: `CAP-${auth.id}`, status: "COMPLETED", amount: auth.amount, final_capture: true };
      responses.set(requestId!, capture);
      return Response.json(capture);
    }
    calls.push({ op: "void", caller });
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
    /** PayPal reports a different payee than requested, as a compromised or buggy path would. */
    reportPayee(merchantId: string) {
      payeeOverride = merchantId;
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
