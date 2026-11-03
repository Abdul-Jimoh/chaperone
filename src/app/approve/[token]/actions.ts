"use server";

import { decideApproval, InvalidApprovalLinkError, type ApprovalChoice } from "@/lib/payments/approvals";
import { paymentDeps } from "@/lib/server";

export type DecideResult = { ok: true; status: string } | { ok: false; error: string };

export async function decide(_prev: DecideResult | null, form: FormData): Promise<DecideResult> {
  const token = String(form.get("token") ?? "");
  const choice = form.get("choice") as ApprovalChoice;
  if (choice !== "approve" && choice !== "reject") return { ok: false, error: "Unknown choice." };
  try {
    const payment = await decideApproval(paymentDeps(), token, choice);
    return { ok: true, status: payment.status };
  } catch (error) {
    if (error instanceof InvalidApprovalLinkError) return { ok: false, error: error.message };
    throw error;
  }
}
