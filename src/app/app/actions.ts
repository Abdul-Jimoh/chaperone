"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { approvalLinkFor, confirmDemoMandate, latestMandate, revokeOwnMandate, simulatePurchase, startDemoShopper, type Scenario } from "@/lib/app/demo";
import { clearSession, sessionUserId, setSession } from "@/lib/app/session";
import { requireEnv } from "@/lib/env";
import { shopLabel } from "@/lib/payments/messages";
import { formatCents } from "@/lib/policy/describe";
import { demoWorld, paymentDeps, serverDb } from "@/lib/server";
import { issueAgentKey } from "@/mcp/keys";

async function requireUser(): Promise<string> {
  const userId = await sessionUserId();
  if (!userId) redirect("/app");
  return userId;
}

export async function startDemo() {
  const userId = await startDemoShopper(serverDb());
  await setSession(userId);
  redirect("/app");
}

export async function endDemo() {
  await clearSession();
  redirect("/");
}

export async function confirmMandate() {
  const userId = await requireUser();
  await confirmDemoMandate(serverDb(), demoWorld(), userId, JSON.parse(requireEnv("MANDATE_SIGNING_JWK")));
  revalidatePath("/app");
}

export type SimulateResult = { ok: true; scenario: Scenario; decision: string; status: string; rule: string; total: string; shop: string } | { ok: false; error: string };

export async function simulate(_prev: SimulateResult | null, form: FormData): Promise<SimulateResult> {
  const userId = await requireUser();
  const scenario = form.get("scenario") as Scenario;
  if (!["allowed", "ask", "injected"].includes(scenario)) return { ok: false, error: "Unknown scenario." };
  const deps = paymentDeps();
  const result = await simulatePurchase(deps, demoWorld(), userId, scenario);
  revalidatePath("/app");
  if (!result.ok) return { ok: false, error: result.issues.join("; ") };
  const mandate = (await latestMandate(deps.db, userId))!;
  return {
    ok: true,
    scenario,
    decision: result.decision,
    status: result.payment.status,
    rule: result.clause.text,
    total: formatCents(result.payment.totalCents),
    shop: shopLabel(mandate.policy, result.payment.payeeMerchantId),
  };
}

export async function revoke() {
  const userId = await requireUser();
  await revokeOwnMandate(paymentDeps(), userId);
  revalidatePath("/app");
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type LinkResult = { ok: true; url: string; qr: string; expiresAt: string } | { ok: false; error: string };

export async function approvalLink(paymentId: string): Promise<LinkResult> {
  const userId = await requireUser();
  const link = await approvalLinkFor(paymentDeps(), userId, paymentId);
  if (!link) return { ok: false, error: "This approval has already been decided or has expired." };
  const url = `${await origin()}/approve/${link.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#121211", light: "#0000" } });
  return { ok: true, url, qr, expiresAt: link.expiresAt.toISOString() };
}

export async function createAgentKey(): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const userId = await requireUser();
  const mandate = await latestMandate(serverDb(), userId);
  if (!mandate || mandate.status !== "active") return { ok: false, error: "There's no active mandate to attach a key to." };
  return { ok: true, key: await issueAgentKey(serverDb(), mandate.id, "dashboard") };
}
