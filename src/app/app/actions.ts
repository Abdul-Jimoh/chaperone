"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import {
  approvalLinkFor,
  compileDemoRules,
  confirmDemoMandate,
  exampleReadBack,
  createDemoAgentKey,
  disconnectAgent,
  latestMandate,
  NotYoursError,
  revokeOwnMandate,
  simulatePurchase,
  startDemoShopper,
  type CompileOutcome,
  type ReadBack,
  type Scenario,
} from "@/lib/app/demo";
import { appOrigin } from "@/lib/app/origin";
import { clearSession, sessionUserId, setSession } from "@/lib/app/session";
import { ConfigError, requireEnv } from "@/lib/env";
import { LlmBudgetExceededError } from "@/lib/llm/llm";
import { shopLabel } from "@/lib/payments/messages";
import { formatCents } from "@/lib/policy/describe";
import { clientId, RateLimitedError } from "@/lib/ratelimit";
import { demoWorld, paymentDeps, serverDb, serverLlm } from "@/lib/server";

/** Limits and ownership checks become a message on the page instead of an error screen. */
async function refusable<T>(run: () => Promise<T>): Promise<T | { refused: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RateLimitedError || error instanceof NotYoursError) return { refused: error.message };
    throw error;
  }
}

const refused = (value: unknown): value is { refused: string } => typeof value === "object" && value !== null && "refused" in value;

async function requireUser(): Promise<string> {
  const userId = await sessionUserId();
  if (!userId) redirect("/app");
  return userId;
}

export async function startDemo(): Promise<{ error: string }> {
  const h = await headers();
  // Vercel sets x-real-ip itself; a client can't choose it.
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userId = await refusable(() => startDemoShopper(serverDb(), clientId(ip, requireEnv("APPROVAL_LINK_SECRET"))));
  if (refused(userId)) return { error: userId.refused };
  await setSession(userId);
  redirect("/app");
}

export async function endDemo() {
  await clearSession();
  redirect("/");
}

export type CompileResponse = CompileOutcome | { ok: false; error: string; example: boolean };

/** Claude's first job, live. When Claude can't be used, the visitor is offered the example's recorded compile instead. */
export async function compileRules(statement: string): Promise<CompileResponse> {
  const userId = await requireUser();
  const deps = { db: serverDb(), llm: serverLlm(userId), world: demoWorld(), secret: requireEnv("APPROVAL_LINK_SECRET") };
  try {
    const result = await refusable(() => compileDemoRules(deps, userId, String(statement ?? "")));
    if (refused(result)) return { ok: false, error: result.refused, example: true };
    return result;
  } catch (error) {
    console.warn("compile failed:", error);
    const why =
      error instanceof LlmBudgetExceededError
        ? "The demo has used its Claude budget, so custom rules are paused."
        : error instanceof ConfigError
          ? "Claude isn't set up on this server."
          : "Claude couldn't draft that just now. Try again in a moment.";
    return { ok: false, error: why, example: true };
  }
}

export async function exampleRules(): Promise<ReadBack> {
  const userId = await requireUser();
  return exampleReadBack(demoWorld(), userId, requireEnv("APPROVAL_LINK_SECRET"));
}

export async function confirmMandate(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const userId = await requireUser();
  const secrets = { draft: requireEnv("APPROVAL_LINK_SECRET"), signingJwk: JSON.parse(requireEnv("MANDATE_SIGNING_JWK")) };
  const result = await refusable(() => confirmDemoMandate(serverDb(), userId, String(form.get("draft") ?? ""), secrets));
  if (refused(result)) return { error: result.refused };
  revalidatePath("/app", "layout");
  return null;
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
  const result = await refusable(() => simulatePurchase(deps, demoWorld(), userId, scenario, attempt));
  if (refused(result)) return { ok: false, error: result.refused, nextAttempt };
  revalidatePath("/app", "layout");
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
  await refusable(() => revokeOwnMandate(paymentDeps(), userId));
  revalidatePath("/app", "layout");
}

export type LinkResult = { ok: true; url: string; qr: string; expiresAt: string } | { ok: false; error: string };

export async function approvalLink(paymentId: string): Promise<LinkResult> {
  const userId = await requireUser();
  const link = await refusable(() => approvalLinkFor(paymentDeps(), userId, paymentId));
  if (refused(link)) return { ok: false, error: link.refused };
  if (!link) return { ok: false, error: "This approval has already been decided or has expired." };
  const url = `${await appOrigin()}/approve/${link.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#121211", light: "#0000" } });
  return { ok: true, url, qr, expiresAt: link.expiresAt.toISOString() };
}

export async function createAgentKey(): Promise<{ ok: true; key: string; endpoint: string } | { ok: false; error: string }> {
  const userId = await requireUser();
  const key = await refusable(() => createDemoAgentKey(serverDb(), userId));
  if (refused(key)) return { ok: false, error: key.refused };
  return { ok: true, key, endpoint: `${await appOrigin()}/api/mcp` };
}

export async function disconnect(agentKeyId: string) {
  const userId = await requireUser();
  if (!UUID.test(agentKeyId)) return;
  await refusable(() => disconnectAgent(serverDb(), userId, agentKeyId));
  revalidatePath("/app", "layout");
}
