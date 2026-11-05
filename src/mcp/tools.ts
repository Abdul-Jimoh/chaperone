import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { mandates, payments } from "@/db/schema";
import { spentByPeriod, type Payment } from "@/lib/ledger/reserve";
import { sweepApprovals } from "@/lib/payments/approvals";
import { outcomeMessage, shopName } from "@/lib/payments/messages";
import { requestPayment, revokeMandate, type PaymentDeps } from "@/lib/payments/service";
import { describePolicy } from "@/lib/policy/describe";
import { hit, LIMITS, refusal } from "@/lib/ratelimit";
import { evaluate } from "@/lib/policy/evaluate";
import { cartSchema, type Policy } from "@/lib/policy/schema";

/** What an MCP agent sends. Everything in it is a proposal that the evaluator re-checks. */
export const cartInput = {
  payee_merchant_id: z.string().describe("PayPal merchant ID of the shop to pay, as listed by check_mandate."),
  items: z
    .array(
      z.object({
        product_id: z.string().optional(),
        title: z.string(),
        unit_price_cents: z.number().int().describe("Price of one unit in US cents."),
        quantity: z.number().int(),
        category: z
          .string()
          .nullable()
          .describe("Lowercase-hyphenated product type, e.g. 'dog-food'; null if unsure (the user may then be asked)."),
      }),
    )
    .min(1),
  shipping_cents: z.number().int().optional(),
  tax_cents: z.number().int().optional(),
};

export type CartInput = z.infer<z.ZodObject<typeof cartInput>>;

function toCart(input: CartInput) {
  return {
    payeeMerchantId: input.payee_merchant_id,
    currency: "USD",
    items: input.items.map((i) => ({
      ...(i.product_id ? { productId: i.product_id } : {}),
      title: i.title,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      category: i.category,
    })),
    shippingCents: input.shipping_cents ?? 0,
    taxCents: input.tax_cents ?? 0,
  };
}

async function loadMandate(deps: PaymentDeps, mandateId: string) {
  const [mandate] = await deps.db.select().from(mandates).where(eq(mandates.id, mandateId));
  if (!mandate) throw new Error("mandate not found");
  return mandate;
}

async function budgets(deps: PaymentDeps, mandateId: string, policy: Policy, now: Date) {
  // MCP requests carry no run, so a per-run budget limits each request on its own.
  const spent = await spentByPeriod(deps.db, mandateId, policy, null, now);
  return {
    spent,
    rows: policy.budgets.map((b) => ({
      period: b.period,
      limit_cents: b.limitCents,
      used_cents: spent[b.period] ?? 0,
      remaining_cents: Math.max(0, b.limitCents - (spent[b.period] ?? 0)),
    })),
  };
}

// Timeouts are applied lazily, so every agent call also moves expired approvals on and frees their budget.
async function sweep(deps: PaymentDeps) {
  await sweepApprovals(deps).catch((error) => console.warn("approval sweep failed:", error));
}

export async function checkMandate(deps: PaymentDeps, mandateId: string, preview?: CartInput) {
  await sweep(deps);
  const now = deps.clock?.() ?? new Date();
  const mandate = await loadMandate(deps, mandateId);
  const { policy } = mandate;
  const { spent, rows } = await budgets(deps, mandateId, policy, now);

  let previewResult;
  if (preview) {
    const cart = cartSchema.safeParse(toCart(preview));
    previewResult = cart.success
      ? (() => {
          const e = evaluate({ policy, mandateStatus: mandate.status, cart: cart.data, spent, now });
          return {
            decision: e.decision,
            clause: e.clause,
            total_cents: e.totalCents,
            failing: e.checks.filter((c) => c.outcome !== "pass"),
            note: "A preview only: nothing is reserved, and request_payment decides again.",
          };
        })()
      : { invalid: cart.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }

  return {
    mandate: {
      id: mandate.id,
      status: mandate.status,
      hash: mandate.hash,
      statement: mandate.statement,
      rules: describePolicy(policy),
      expires_at: policy.expiresAt,
    },
    shops: policy.merchants.map((m) => ({ name: m.name, merchant_id: m.merchantId })),
    categories: policy.categories,
    per_purchase_cap_cents: policy.perTransactionCapCents,
    ask_user_above_cents: policy.approvalThresholdCents,
    max_quantity_per_item: policy.maxQuantityPerItem,
    budgets: rows,
    ...(previewResult ? { preview: previewResult } : {}),
  };
}

function view(policy: Policy, p: Payment) {
  return {
    payment_id: p.id,
    created_at: p.createdAt.toISOString(),
    shop: shopName(policy, p.payeeMerchantId),
    total_cents: p.totalCents,
    decision: p.decision,
    rule: p.clauseText,
    status: p.status,
    source: p.source,
  };
}

export async function listSpend(deps: PaymentDeps, mandateId: string, limit = 20) {
  await sweep(deps);
  const now = deps.clock?.() ?? new Date();
  const mandate = await loadMandate(deps, mandateId);
  const recent = await deps.db
    .select()
    .from(payments)
    .where(eq(payments.mandateId, mandateId))
    .orderBy(desc(payments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return {
    mandate_status: mandate.status,
    budgets: (await budgets(deps, mandateId, mandate.policy, now)).rows,
    payments: recent.map((p) => view(mandate.policy, p)),
  };
}

export async function requestPaymentTool(deps: PaymentDeps, mandateId: string, input: CartInput) {
  await sweep(deps);
  const verdict = await hit(deps.db, [[LIMITS.purchasesPerShopper, mandateId], [LIMITS.purchasesAll, null]], deps.clock?.());
  if (!verdict.ok) return { error: "rate_limited", retry_after_seconds: verdict.retryAfterSec, message: `${refusal(verdict)} Nothing was recorded or charged.` };
  const result = await requestPayment(deps, { mandateId, runId: null, source: "mcp", cart: toCart(input) });
  if (!result.ok) {
    return { error: "invalid_cart", issues: result.issues, message: "The cart is malformed; nothing was recorded or charged." };
  }
  const { policy } = await loadMandate(deps, mandateId);
  const p = result.payment;
  return {
    ...view(policy, p),
    clause_id: p.clauseId,
    already_requested: result.replayed,
    message: outcomeMessage(policy, p),
  };
}

export async function revokeMandateTool(deps: PaymentDeps, mandateId: string) {
  const result = await revokeMandate(deps, mandateId, "agent");
  return {
    revoked: true,
    already_revoked: result.alreadyRevoked,
    holds_released: result.voided.length,
    holds_still_open: result.stillOpen.length,
    message: "The mandate is revoked. Every further payment request under it will be denied.",
  };
}
