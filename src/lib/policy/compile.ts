import { z } from "zod";
import type { Llm } from "@/lib/llm/llm";
import { describePolicy } from "./describe";
import { BUDGET_PERIODS, policySchema, type Policy } from "./schema";

export type Shop = { key: string; name: string; merchantId: string };

export type CompileResult =
  | { ok: true; policy: Policy; readBack: string[]; notEnforced: string[] }
  | { ok: false; problems: string[] };

/** What Claude may fill in. Shops are picked from known keys, so it can never introduce a payee. */
function draftSchema(shopKeys: [string, ...string[]]) {
  return z.object({
    shops: z.array(z.enum(shopKeys)),
    categories: z.array(z.string()),
    perPurchaseMaxUsd: z.number().nullable(),
    askAboveUsd: z.number().nullable(),
    budgets: z.array(z.object({ period: z.enum(BUDGET_PERIODS), maxUsd: z.number() })),
    maxQuantityPerItem: z.number().int().nullable(),
    schedule: z.object({ every: z.number().int(), unit: z.enum(["day", "week", "month"]) }).nullable(),
    validForDays: z.number().int().nullable(),
    notEnforceable: z.array(z.string()),
  });
}

export type MandateDraft = z.infer<ReturnType<typeof draftSchema>>;

const SYSTEM = `You turn a person's spending rules for a shopping agent into a structured draft.
The draft is shown back to them in plain language and only takes effect after they confirm it, so record exactly what they said and never add limits or permissions they didn't state.

Fields:
- shops: keys of the shops they allow, from the list provided. If they say "these shops" or "my usual shops" without naming any, use every listed shop.
- categories: what they want bought, as short generic product types ("coffee", "dog-food"). Empty if they didn't restrict it.
- perPurchaseMaxUsd: the most for one purchase or one run's checkout, if stated.
- askAboveUsd: they want to approve purchases above this amount.
- budgets: spending limits per period. "run" is one shopping trip; "day", "week" and "month" are calendar windows.
- maxQuantityPerItem: the most units of any one item, if stated.
- schedule: how often to shop, if stated ("every two weeks" is every 2, unit week).
- validForDays: if they gave an end ("for the next 3 months" is 90).
- notEnforceable: any rule you couldn't express in these fields, in their words.
Amounts are US dollars. Use null or an empty list for anything they didn't say.`;

function toCents(usd: number): number {
  return Math.round(usd * 100);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Deterministic half of compilation: the draft becomes a policy only if it passes the policy schema. */
export function draftToPolicy(
  draft: MandateDraft,
  context: { shops: Shop[]; timezone: string; now: Date },
): CompileResult {
  const problems: string[] = [];
  const shops = context.shops.filter((s) => draft.shops.includes(s.key));
  if (shops.length === 0) problems.push("Name at least one shop the agent may pay.");

  const budgets = draft.budgets.map((b) => ({ period: b.period, limitCents: toCents(b.maxUsd) }));
  const smallestBudget = budgets.length ? Math.min(...budgets.map((b) => b.limitCents)) : null;
  // Without an explicit per-purchase cap, no single purchase may exceed the tightest budget anyway.
  const cap = draft.perPurchaseMaxUsd !== null ? toCents(draft.perPurchaseMaxUsd) : smallestBudget;
  if (cap === null) problems.push("Say how much the agent may spend, per purchase or per day, week or month.");
  if (problems.length) return { ok: false, problems };

  const candidate = {
    version: 1,
    currency: "USD",
    timezone: context.timezone,
    perTransactionCapCents: cap,
    approvalThresholdCents: draft.askAboveUsd === null ? null : toCents(draft.askAboveUsd),
    budgets,
    merchants: shops.map((s) => ({ merchantId: s.merchantId, name: s.name })),
    categories: [...new Set(draft.categories.map(slug).filter(Boolean))],
    maxQuantityPerItem: draft.maxQuantityPerItem,
    schedule: draft.schedule,
    expiresAt:
      draft.validForDays === null
        ? null
        : new Date(context.now.getTime() + draft.validForDays * 86_400_000).toISOString(),
  };
  const parsed = policySchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "policy"}: ${i.message}`) };
  }
  return {
    ok: true,
    policy: parsed.data,
    readBack: describePolicy(parsed.data),
    notEnforced: draft.notEnforceable,
  };
}

/** Claude drafts, code validates. The result is a proposal for the user to confirm, never a signed mandate. */
export async function compileMandate(
  llm: Llm,
  input: { statement: string; shops: Shop[]; timezone: string; now?: Date },
): Promise<CompileResult> {
  const keys = input.shops.map((s) => s.key);
  if (keys.length === 0) throw new Error("compileMandate needs at least one known shop");
  const shopList = input.shops.map((s) => `- ${s.key}: ${s.name}`).join("\n");
  const { data } = await llm.structured("compile_mandate", draftSchema(keys as [string, ...string[]]), {
    max_tokens: 4000,
    effort: "low",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Shops:\n${shopList}\n\nTheir rules:\n<rules>\n${input.statement}\n</rules>`,
      },
    ],
  });
  return draftToPolicy(data, { shops: input.shops, timezone: input.timezone, now: input.now ?? new Date() });
}
