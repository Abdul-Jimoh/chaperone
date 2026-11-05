"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { approvalLinkFor, confirmDemoMandate, latestMandate, revokeOwnMandate, simulatePurchase, startDemoShopper, type Scenario } from "@/lib/app/demo";
import { appOrigin } from "@/lib/app/origin";
import { clearSession, sessionUserId, setSession } from "@/lib/app/session";
import { requireEnv } from "@/lib/env";
import { shopLabel } from "@/lib/payments/messages";
import { formatCents } from "@/lib/policy/describe";
import { clientId, hit, LIMITS, refusal } from "@/lib/ratelimit";
import { demoWorld, paymentDeps, serverDb } from "@/lib/server";
import { issueAgentKey } from "@/mcp/keys";

async function requireUser(): Promise<string> {
  const userId = await sessionUserId();
  if (!userId) redirect("/app");
  return userId;
}

export async function startDemo(_prev: { error: string } | null): Promise<{ error: string }> {
  const h = await headers();
  // Vercel sets x-real-ip itself; a client can't choose it.
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const verdict = await hit(serverDb(), [
    [LIMITS.demoStartPerClient, clientId(ip, requireEnv("APPROVAL_LINK_SECRET"))],
    [LIMITS.demoStartAll, null],
  ]);
  if (!verdict.ok) return { error: refusal(verdict) };
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

export type SimulateResult = ({ ok: true; scenario: Scenario; decision: string; status: string; rule: string; total: string; shop: string } | { ok: false; error: string }) & {
  nextAttempt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function simulate(_prev: SimulateResult | null, form: FormData): Promise<SimulateResult> {
  const userId = await requireUser();
  const scenario = form.get("scenario") as Scenario;
  const attempt = String(form.get("attempt"));
  const nextAttempt = randomUUID();
  if (!["allowed", "ask", "injected"].includes(scenario) || !UUID.test(attempt)) return { ok: false, error: "Unknown scenario.", nextAttempt };
  const deps = paymentDeps();
  const verdict = await hit(deps.db, [
    [LIMITS.purchasesPerShopper, userId],
    [LIMITS.purchasesAll, null],
  ]);
  if (!verdict.ok) return { ok: false, error: refusal(verdict), nextAttempt };
  const result = await simulatePurchase(deps, demoWorld(), userId, scenario, attempt);
  revalidatePath("/app");
  if (!result.ok) return { ok: false, error: result.issues.join("; "), nextAttempt };
  const mandate = (await latestMandate(deps.db, userId))!;
  return {
    ok: true,
    scenario,
    decision: result.decision,
    status: result.payment.status,
    rule: result.clause.text,
    total: formatCents(result.payment.totalCents),
    shop: shopLabel(mandate.policy, result.payment.payeeMerchantId),
    nextAttempt,
  };
}

export async function revoke() {
  const userId = await requireUser();
  await revokeOwnMandate(paymentDeps(), userId);
  revalidatePath("/app");
}

export type LinkResult = { ok: true; url: string; qr: string; expiresAt: string } | { ok: false; error: string };

export async function approvalLink(paymentId: string): Promise<LinkResult> {
  const userId = await requireUser();
  const verdict = await hit(serverDb(), [[LIMITS.approvalLinksPerShopper, userId]]);
  if (!verdict.ok) return { ok: false, error: refusal(verdict) };
  const link = await approvalLinkFor(paymentDeps(), userId, paymentId);
  if (!link) return { ok: false, error: "This approval has already been decided or has expired." };
  const url = `${await appOrigin()}/approve/${link.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#121211", light: "#0000" } });
  return { ok: true, url, qr, expiresAt: link.expiresAt.toISOString() };
}

export async function createAgentKey(): Promise<{ ok: true; key: string; endpoint: string } | { ok: false; error: string }> {
  const userId = await requireUser();
  const mandate = await latestMandate(serverDb(), userId);
  if (!mandate || mandate.status !== "active") return { ok: false, error: "There's no active mandate to attach a key to." };
  const verdict = await hit(serverDb(), [[LIMITS.agentKeysPerShopper, userId]]);
  if (!verdict.ok) return { ok: false, error: refusal(verdict) };
  return { ok: true, key: await issueAgentKey(serverDb(), mandate.id, "dashboard"), endpoint: `${await appOrigin()}/api/mcp` };
}
