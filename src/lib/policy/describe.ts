import type { BudgetPeriod, Policy } from "./schema";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

const PERIOD_LABEL: Record<BudgetPeriod, string> = {
  run: "per shopping run",
  day: "per day",
  week: "per week",
  month: "per month",
};

export type ClauseId =
  | "mandate.revoked"
  | "mandate.expired"
  | "currency"
  | "payee.allowlist"
  | "item.category"
  | "item.quantity"
  | "txn.cap"
  | `budget.${BudgetPeriod}`
  | "approval.category_unknown"
  | "approval.threshold"
  | "within_limits";

export function clauseText(policy: Policy, id: ClauseId): string {
  switch (id) {
    case "mandate.revoked":
      return "This mandate has been revoked";
    case "mandate.expired":
      return `This mandate expired on ${new Date(policy.expiresAt!).toUTCString()}`;
    case "currency":
      return `Pay in ${policy.currency} only`;
    case "payee.allowlist":
      return `Only pay these shops: ${policy.merchants.map((m) => m.name).join(", ")}`;
    case "item.category":
    case "approval.category_unknown":
      return `Only buy: ${policy.categories.join(", ")}`;
    case "item.quantity":
      return `At most ${policy.maxQuantityPerItem} of any one item`;
    case "txn.cap":
      return `Max ${formatCents(policy.perTransactionCapCents)} per purchase`;
    case "approval.threshold":
      return `Ask me before anything over ${formatCents(policy.approvalThresholdCents ?? 0)}`;
    case "within_limits":
      return "Within every limit of this mandate";
    default: {
      const period = id.slice("budget.".length) as BudgetPeriod;
      const budget = policy.budgets.find((b) => b.period === period);
      return `Spend at most ${formatCents(budget?.limitCents ?? 0)} ${PERIOD_LABEL[period]}`;
    }
  }
}

/** The plain-language read-back the user confirms before a mandate is signed. */
export function describePolicy(policy: Policy): string[] {
  const lines: string[] = [];
  if (policy.categories.length) lines.push(clauseText(policy, "item.category"));
  lines.push(clauseText(policy, "payee.allowlist"));
  lines.push(clauseText(policy, "txn.cap"));
  for (const b of policy.budgets) lines.push(clauseText(policy, `budget.${b.period}`));
  if (policy.maxQuantityPerItem !== null) lines.push(clauseText(policy, "item.quantity"));
  if (policy.approvalThresholdCents !== null) lines.push(clauseText(policy, "approval.threshold"));
  const schedule = scheduleLine(policy);
  if (schedule) lines.push(schedule);
  lines.push(
    policy.expiresAt
      ? `Valid until ${new Date(policy.expiresAt).toUTCString()}`
      : "Valid until you revoke it",
  );
  return lines;
}

/** The evaluator doesn't check the schedule; it tells the agent (and the person) when a trip is due. */
export function scheduleLine(policy: Policy): string | null {
  if (!policy.schedule) return null;
  const { every, unit } = policy.schedule;
  return every === 1 ? `Shop once a ${unit}` : `Shop every ${every} ${unit}s`;
}
