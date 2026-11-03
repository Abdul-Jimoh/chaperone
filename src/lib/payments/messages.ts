import type { Payment } from "@/lib/ledger/reserve";
import { formatCents } from "@/lib/policy/describe";
import type { Policy } from "@/lib/policy/schema";
import { APPROVAL_TIMEOUT_MS } from "./service";

export function shopName(policy: Policy, merchantId: string): string {
  return policy.merchants.find((m) => m.merchantId === merchantId)?.name ?? `unlisted payee ${merchantId}`;
}

/** The shop name a person sees; agents get the raw merchant ID from shopName. */
export function shopLabel(policy: Policy, merchantId: string): string {
  return policy.merchants.find((m) => m.merchantId === merchantId)?.name ?? "A shop not on your list";
}

/** What an agent is told about a payment. Plain facts only; the rule text comes from the mandate. */
export function outcomeMessage(policy: Policy, p: Payment): string {
  const detail = p.checks.find((c) => c.clause === p.clauseId)?.detail;
  const amount = formatCents(p.totalCents);
  const shop = shopName(policy, p.payeeMerchantId);
  switch (p.status) {
    case "captured":
      return `Paid ${amount} to ${shop}.`;
    case "pending_approval":
      return `A hold of ${amount} is placed with ${shop} and the user has been asked to approve it (${p.clauseText}). It is captured if they approve and released if they reject or don't answer within ${APPROVAL_TIMEOUT_MS / 3_600_000} hours. Use list_spend to see the outcome.`;
    case "denied":
      return `Denied by the mandate: ${p.clauseText}${detail ? ` (${detail})` : ""}. Nothing was charged.`;
    case "failed":
      return "PayPal did not place the hold. Nothing was charged.";
    case "voided":
      return "The hold was released. Nothing was charged.";
    case "authorizing":
    case "capturing":
    case "voiding":
      return "This payment is still being processed. Send the same request again shortly to see the result; it will not pay twice.";
    default:
      return `A hold of ${amount} is placed with ${shop} but has not been captured.`;
  }
}

