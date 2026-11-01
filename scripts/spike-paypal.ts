// Manual sandbox spike: pnpm tsx scripts/spike-paypal.ts <command>. State goes to docs/private/spike-state.json (gitignored).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPayPalClient, PayPalError } from "@/lib/paypal/client";
import { createAuthorizeOrder, firstAuthorization, getOrder, type Order } from "@/lib/paypal/orders";
import { captureAuthorization, getAuthorization, reauthorize, voidAuthorization } from "@/lib/paypal/payments";
import { createPayeeClients, payeeCredentialsFromEnv, voidHold } from "@/lib/paypal/payees";
import { approveLink, createPaymentTokenFromSetupToken, createPayPalSetupToken } from "@/lib/paypal/vault";

process.loadEnvFile(".env.local");
const STATE = "docs/private/spike-state.json";
const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

const client = createPayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET! });
const payees: Record<string, string | undefined> = {
  a: process.env.PAYPAL_SHOP_A_MERCHANT_ID,
  b: process.env.PAYPAL_SHOP_B_MERCHANT_ID,
  c: process.env.PAYPAL_SHOP_C_MERCHANT_ID,
  rogue: process.env.PAYPAL_ROGUE_MERCHANT_ID,
};
const show = (label: string, v: unknown) => console.log(`\n${label}\n${JSON.stringify(v, null, 2)}`);

const [cmd, arg1, arg2] = process.argv.slice(2);

try {
  switch (cmd) {
    case "token": {
      await client.accessToken();
      console.log("OAuth OK");
      break;
    }
    case "vault-start": {
      const st = await createPayPalSetupToken(client, {
        returnUrl: "http://localhost:3000/spike/return",
        cancelUrl: "http://localhost:3000/spike/cancel",
        requestId: randomUUID(),
      });
      state.setupTokenId = st.id;
      if (st.customer?.id) state.customerId = st.customer.id;
      save();
      show("setup token", { id: st.id, status: st.status, customer: st.customer });
      console.log(`\nOpen and approve as the sandbox buyer:\n${approveLink(st)}`);
      break;
    }
    case "setup-status": {
      const { data } = await client.request<{ id: string; status: string }>(
        `/v3/vault/setup-tokens/${arg1 ?? state.setupTokenId}`,
      );
      console.log(data.status);
      break;
    }
    case "vault-finish": {
      const pt = await createPaymentTokenFromSetupToken(client, arg1 ?? state.setupTokenId!, randomUUID());
      state.vaultId = pt.id;
      state.customerId = pt.customer.id;
      save();
      show("payment token", { id: pt.id, customer: pt.customer, payer: pt.payment_source.paypal?.email_address });
      break;
    }
    case "authorize": {
      const payee = payees[arg1 ?? "a"];
      const cents = Math.round(Number(arg2 ?? "18") * 100);
      const paymentId = randomUUID();
      const order = await createAuthorizeOrder(client, {
        vaultId: state.vaultId!,
        payeeMerchantId: payee!,
        currency: "USD",
        items: [{ productId: "spike-1", title: "Spike test item", unitPriceCents: cents, quantity: 1, category: null }],
        shippingCents: 0,
        taxCents: 0,
        paymentId,
        requestId: randomUUID(),
      });
      const auth = firstAuthorization(order);
      if (auth) state.lastAuthorizationId = auth.id;
      state.lastOrderId = order.id;
      save();
      show("order", { id: order.id, status: order.status, payee: order.purchase_units[0]?.payee, authorization: auth });
      break;
    }
    case "authorize-self": {
      const { data: order } = await client.request<Order>("/v2/checkout/orders", {
        method: "POST",
        requestId: randomUUID(),
        body: {
          intent: "AUTHORIZE",
          purchase_units: [{ amount: { currency_code: "USD", value: arg1 ?? "5.00" } }],
          payment_source: { paypal: { vault_id: state.vaultId } },
        },
      });
      const auth = firstAuthorization(order);
      if (auth) state.lastAuthorizationId = auth.id;
      state.lastOrderId = order.id;
      save();
      show("order", { id: order.id, status: order.status, payee: order.purchase_units[0]?.payee, authorization: auth?.id });
      break;
    }
    case "order":
      show("order", await getOrder(client, arg1 ?? state.lastOrderId!));
      break;
    case "auth":
      show("authorization", await getAuthorization(client, arg1 ?? state.lastAuthorizationId!));
      break;
    case "capture":
      show("capture", await captureAuthorization(client, arg1 ?? state.lastAuthorizationId!, { requestId: randomUUID() }));
      break;
    case "void":
      show("void", await voidAuthorization(client, arg1 ?? state.lastAuthorizationId!, randomUUID()));
      break;
    case "void-hold": {
      const payees = createPayeeClients(payeeCredentialsFromEnv(process.env));
      const authorizationId = arg1 ?? state.lastAuthorizationId!;
      const { payee } = await getAuthorization(client, authorizationId);
      show(
        "void via payee credentials",
        await voidHold({ platform: client, payees, authorizationId, expectedPayeeMerchantId: payee!.merchant_id!, requestId: randomUUID() }),
      );
      break;
    }
    case "reauthorize":
      show("reauthorize", await reauthorize(client, arg1 ?? state.lastAuthorizationId!, { amountCents: 1800, currency: "USD", requestId: randomUUID() }));
      break;
    default:
      console.log("commands: token | vault-start | vault-finish [setupTokenId] | authorize [a|b|c|rogue] [usd] | order [id] | auth [id] | capture [id] | void [id] | void-hold [id] | setup-status | authorize-self [usd] | reauthorize [id]");
  }
} catch (e) {
  if (e instanceof PayPalError) {
    show(`PayPalError ${e.status} debug_id=${e.debugId}`, e.body);
    process.exitCode = 1;
  } else throw e;
}
