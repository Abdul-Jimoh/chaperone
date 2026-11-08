import type { AppData } from "@/app/app/data";
import { shopLabel } from "@/lib/payments/messages";
import type { Policy } from "@/lib/policy/schema";
import { formatCents } from "@/lib/policy/describe";
import { decisionLabel, StatusPill } from "./ui";

type Payment = AppData["recent"][number];

export const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export function ActivityList({ payments, policy, empty }: { payments: Payment[]; policy: Policy; empty: string }) {
  if (payments.length === 0) return <p className="rounded-2xl border border-dashed border-line-strong p-6 text-ink-2">{empty}</p>;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-4 py-3.5">
          <div className="min-w-0">
            <p className="font-medium">
              {shopLabel(policy, p.payeeMerchantId)} · {formatCents(p.totalCents)}
              <span className="font-normal text-ink-2"> · {decisionLabel(p.decision)}</span>
              {p.source === "mcp" && <span className="ml-2 rounded-full border border-line-strong px-2 py-0.5 align-middle text-[0.72rem] text-ink-2">your agent</span>}
            </p>
            <p className="truncate text-[0.86rem] text-ink-2">
              {when(p.createdAt)} · {p.clauseText}
            </p>
          </div>
          <StatusPill status={p.status} />
        </li>
      ))}
    </ul>
  );
}
