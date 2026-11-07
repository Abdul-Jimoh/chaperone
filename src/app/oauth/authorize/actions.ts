"use server";

import { redirect } from "next/navigation";
import { activeMandate } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { requireEnv } from "@/lib/env";
import { approvedRedirect, checkAuthorize, issueCode } from "@/lib/oauth";
import { endpoints } from "@/lib/oauth-http";
import { enforce, LIMITS, RateLimitedError } from "@/lib/ratelimit";
import { serverDb } from "@/lib/server";

const PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource", "scope"];

async function recheck(form: FormData) {
  const params = Object.fromEntries(PARAMS.map((p) => [p, form.get(p)?.toString() || undefined]));
  return checkAuthorize(requireEnv("APPROVAL_LINK_SECRET"), (await endpoints()).resource, params);
}

export async function allowConnect(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const check = await recheck(form);
  if (!check.ok) return "redirect" in check ? redirect(check.redirect) : { error: check.show };
  const userId = await sessionUserId();
  const mandate = userId ? await activeMandate(serverDb(), userId) : null;
  if (!userId || !mandate) return { error: "Open the Chaperone demo in this browser and sign your rules first." };
  try {
    await enforce(serverDb(), [[LIMITS.oauthConnectsPerShopper, userId]]);
  } catch (error) {
    if (error instanceof RateLimitedError) return { error: error.message };
    throw error;
  }
  const code = await issueCode(serverDb(), check.request, mandate.id);
  redirect(approvedRedirect(check.request, code));
}

export async function cancelConnect(form: FormData) {
  const check = await recheck(form);
  if (!check.ok) return "redirect" in check ? redirect(check.redirect) : undefined;
  const url = new URL(check.request.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "The user cancelled the connection.");
  if (check.request.state) url.searchParams.set("state", check.request.state);
  redirect(url.toString());
}
