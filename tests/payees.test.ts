import { describe, expect, it } from "vitest";
import { createPayPalClient } from "@/lib/paypal/client";
import {
  createPayeeClients,
  PayeeMismatchError,
  payeeCredentialsFromEnv,
  UnknownPayeeError,
  voidHold,
} from "@/lib/paypal/payees";
import { ROGUE, SHOP_A, SHOP_B } from "./support/fixtures";

/** A fake PayPal that records which app's token each void was sent with. */
function fakePayPal(authPayee: string, status = "CREATED") {
  const voids: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/v1/oauth2/token")) {
      const clientId = Buffer.from(headers.get("authorization")!.slice(6), "base64").toString().split(":")[0];
      return Response.json({ access_token: `token-${clientId}`, expires_in: 3600 });
    }
    const caller = headers.get("authorization")!.replace("Bearer token-", "");
    if (url.endsWith("/void")) {
      voids.push(caller);
      return Response.json({ id: "AUTH1", status: "VOIDED", payee: { merchant_id: authPayee } });
    }
    return Response.json({ id: "AUTH1", status, payee: { merchant_id: authPayee } });
  };
  return { fetch, voids };
}

const credentials = {
  [SHOP_A]: { clientId: "shop-a-app", clientSecret: "x" },
  [SHOP_B]: { clientId: "shop-b-app", clientSecret: "x" },
};

function setup(authPayee: string, status?: string) {
  const fake = fakePayPal(authPayee, status);
  const platform = createPayPalClient({ clientId: "platform-app", clientSecret: "x", fetch: fake.fetch });
  const payees = createPayeeClients(credentials, { fetch: fake.fetch });
  return { ...fake, platform, payees };
}

describe("voidHold", () => {
  it("voids with the credentials of the payee PayPal reports, and only those", async () => {
    const { platform, payees, voids } = setup(SHOP_B);
    const result = await voidHold({ platform, payees, authorizationId: "AUTH1", expectedPayeeMerchantId: SHOP_B, requestId: "r1" });
    expect(result?.status).toBe("VOIDED");
    expect(voids).toEqual(["shop-b-app"]);
  });

  it("refuses when PayPal's payee disagrees with the ledger", async () => {
    const { platform, payees, voids } = setup(SHOP_A);
    await expect(
      voidHold({ platform, payees, authorizationId: "AUTH1", expectedPayeeMerchantId: SHOP_B, requestId: "r1" }),
    ).rejects.toBeInstanceOf(PayeeMismatchError);
    expect(voids).toEqual([]);
  });

  it("has no credentials for a payee outside the shops", async () => {
    const { platform, payees, voids } = setup(ROGUE);
    await expect(
      voidHold({ platform, payees, authorizationId: "AUTH1", expectedPayeeMerchantId: ROGUE, requestId: "r1" }),
    ).rejects.toBeInstanceOf(UnknownPayeeError);
    expect(voids).toEqual([]);
  });

  it("treats an already voided hold as done", async () => {
    const { platform, payees, voids } = setup(SHOP_A, "VOIDED");
    const result = await voidHold({ platform, payees, authorizationId: "AUTH1", expectedPayeeMerchantId: SHOP_A, requestId: "r1" });
    expect(result?.status).toBe("VOIDED");
    expect(voids).toEqual([]);
  });
});

describe("payeeCredentialsFromEnv", () => {
  it("keys credentials by merchant ID and skips shops without an app", () => {
    const creds = payeeCredentialsFromEnv({
      PAYPAL_SHOP_A_MERCHANT_ID: SHOP_A,
      PAYPAL_SHOP_A_CLIENT_ID: "a",
      PAYPAL_SHOP_A_CLIENT_SECRET: "sa",
      PAYPAL_SHOP_B_MERCHANT_ID: SHOP_B,
      PAYPAL_SHOP_B_CLIENT_ID: "",
    });
    expect(Object.keys(creds)).toEqual([SHOP_A]);
  });
});
