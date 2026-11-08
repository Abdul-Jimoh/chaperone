import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { paymentMethods } from "@/db/schema";
import type { PayPalClient } from "@/lib/paypal/client";
import { createPaymentTokenFromSetupToken, createPayPalSetupToken } from "@/lib/paypal/vault";

export type WalletDeps = { db: Db; platform: PayPalClient; secret: string };

/** Whose PayPal pays: the shared sandbox buyer every demo shopper starts with, or an account the shopper linked. */
export type Wallet = { kind: "demo" } | { kind: "own"; email: string } | { kind: "none" };

const TICKET_TTL_MS = 15 * 60_000;

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(`wallet-link:${payload}`).digest();
}

/**
 * The setup token's id passes through the browser and comes back when PayPal approves it. The ticket ties it to the
 * shopper who started the link, so one shopper can't finish (and pay with) a wallet another shopper approved.
 */
function ticketFor(secret: string, userId: string, setupTokenId: string, now: Date): string {
  const payload = `${userId}.${setupTokenId}.${now.getTime() + TICKET_TTL_MS}`;
  return `${now.getTime() + TICKET_TTL_MS}.${mac(secret, payload).toString("base64url")}`;
}

function ticketValid(secret: string, ticket: string, userId: string, setupTokenId: string, now: Date): boolean {
  const [expires, signature] = ticket.split(".");
  if (!expires || !signature || Number(expires) < now.getTime()) return false;
  const expected = mac(secret, `${userId}.${setupTokenId}.${expires}`);
  const given = Buffer.from(signature, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function startWalletLink(deps: WalletDeps, userId: string, origin: string, now = new Date()) {
  const setup = await createPayPalSetupToken(deps.platform, {
    returnUrl: `${origin}/app`,
    cancelUrl: `${origin}/app`,
    requestId: `setup:${randomUUID()}`,
  });
  return { setupToken: setup.id, ticket: ticketFor(deps.secret, userId, setup.id, now) };
}

export class WalletLinkError extends Error {}

/** Exchanges the approved setup token for a payment token, which replaces the shopper's current wallet. */
export async function finishWalletLink(deps: WalletDeps, userId: string, setupTokenId: string, ticket: string, now = new Date()): Promise<Wallet> {
  if (!ticketValid(deps.secret, ticket, userId, setupTokenId, now)) throw new WalletLinkError("This PayPal link expired. Start it again.");
  // Keyed on the setup token, so a retried exchange returns the same payment token instead of a second one.
  const token = await createPaymentTokenFromSetupToken(deps.platform, setupTokenId, `vault:${setupTokenId}`);
  const email = token.payment_source.paypal?.email_address ?? "your PayPal account";
  await deps.db.transaction(async (tx) => {
    await tx
      .update(paymentMethods)
      .set({ status: "revoked" })
      .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.status, "active")));
    await tx
      .insert(paymentMethods)
      .values({ userId, paypalPaymentTokenId: token.id, paypalCustomerId: token.customer?.id, payerEmail: email })
      .onConflictDoUpdate({ target: [paymentMethods.userId, paymentMethods.paypalPaymentTokenId], set: { status: "active", payerEmail: email } });
  });
  return { kind: "own", email };
}

export async function walletOf(db: Db, userId: string): Promise<Wallet> {
  const [method] = await db
    .select({ email: paymentMethods.payerEmail })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.status, "active")))
    .orderBy(desc(paymentMethods.createdAt))
    .limit(1);
  if (!method) return { kind: "none" };
  return method.email ? { kind: "own", email: method.email } : { kind: "demo" };
}
