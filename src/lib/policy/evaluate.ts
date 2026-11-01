import { clauseText, formatCents, type ClauseId } from "./describe";
import type { BudgetPeriod, Cart, Policy } from "./schema";

export type Decision = "allow" | "needs_approval" | "deny";

export type Check = {
  clause: ClauseId;
  text: string;
  outcome: "pass" | "deny" | "needs_approval";
  detail?: string;
};

export type Evaluation = {
  decision: Decision;
  /** The clause that decided the outcome: the first failing deny, else the first approval trigger. */
  clause: { id: ClauseId; text: string; detail?: string };
  totalCents: number;
  checks: Check[];
};

export type EvaluationInput = {
  policy: Policy;
  mandateStatus: "active" | "revoked";
  cart: Cart;
  /** Cents already reserved or captured in each budget window, excluding this cart. */
  spent: Partial<Record<BudgetPeriod, number>>;
  now: Date;
};

export function cartTotalCents(cart: Cart): number {
  return cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0) + cart.shippingCents + cart.taxCents;
}

/**
 * The only place a payment decision is made. Pure and deterministic: no I/O, no clock, no LLM.
 * Every clause is checked and reported so the ledger can show all the reasons, not just the first.
 */
export function evaluate({ policy, mandateStatus, cart, spent, now }: EvaluationInput): Evaluation {
  const totalCents = cartTotalCents(cart);
  const checks: Check[] = [];
  const add = (clause: ClauseId, outcome: Check["outcome"], detail?: string) =>
    checks.push({ clause, text: clauseText(policy, clause), outcome, detail });

  add("mandate.revoked", mandateStatus === "revoked" ? "deny" : "pass");

  if (policy.expiresAt !== null) {
    add("mandate.expired", now.getTime() >= Date.parse(policy.expiresAt) ? "deny" : "pass");
  }

  add(
    "currency",
    cart.currency === policy.currency ? "pass" : "deny",
    cart.currency === policy.currency ? undefined : `Cart is in ${cart.currency}`,
  );

  const payee = policy.merchants.find((m) => m.merchantId === cart.payeeMerchantId);
  add("payee.allowlist", payee ? "pass" : "deny", payee ? payee.name : `Payee ${cart.payeeMerchantId} is not an allowed shop`);

  if (policy.categories.length) {
    const outside = cart.items.filter((i) => i.category !== null && !policy.categories.includes(i.category));
    add(
      "item.category",
      outside.length ? "deny" : "pass",
      outside.length ? outside.map((i) => `${i.title} (${i.category})`).join(", ") : undefined,
    );
  }

  if (policy.maxQuantityPerItem !== null) {
    const max = policy.maxQuantityPerItem;
    const over = cart.items.filter((i) => i.quantity > max);
    add(
      "item.quantity",
      over.length ? "deny" : "pass",
      over.length ? over.map((i) => `${i.quantity} × ${i.title}`).join(", ") : undefined,
    );
  }

  const overCap = totalCents > policy.perTransactionCapCents;
  add("txn.cap", overCap ? "deny" : "pass", `Cart total ${formatCents(totalCents)}`);

  for (const budget of policy.budgets) {
    const already = spent[budget.period] ?? 0;
    const after = already + totalCents;
    add(
      `budget.${budget.period}`,
      after > budget.limitCents ? "deny" : "pass",
      `${formatCents(already)} already used; this would make ${formatCents(after)}`,
    );
  }

  if (policy.categories.length) {
    const unknown = cart.items.filter((i) => i.category === null);
    if (unknown.length) {
      add("approval.category_unknown", "needs_approval", unknown.map((i) => i.title).join(", "));
    }
  }

  if (policy.approvalThresholdCents !== null) {
    const over = totalCents > policy.approvalThresholdCents;
    add("approval.threshold", over ? "needs_approval" : "pass", `Cart total ${formatCents(totalCents)}`);
  }

  const deny = checks.find((c) => c.outcome === "deny");
  if (deny) return { decision: "deny", clause: pick(deny), totalCents, checks };

  const ask = checks.find((c) => c.outcome === "needs_approval");
  if (ask) return { decision: "needs_approval", clause: pick(ask), totalCents, checks };

  return {
    decision: "allow",
    clause: { id: "within_limits", text: clauseText(policy, "within_limits") },
    totalCents,
    checks,
  };
}

function pick(c: Check): Evaluation["clause"] {
  return { id: c.clause, text: c.text, detail: c.detail };
}
