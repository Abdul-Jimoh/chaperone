import type { Policy } from "@/lib/policy/schema";
import { windowStart } from "@/lib/policy/windows";

export type LedgerRow = {
  id: string;
  at: string;
  shop: string;
  items: string;
  totalCents: number;
  decision: string;
  rule: string;
  status: string;
  source: string;
  mandateId: string;
  mandateHash: string;
  mandateLabel: string;
  /** The budget window the payment counts against, e.g. "November 2026", and that window's limit. */
  window: string;
  windowLimitCents: number | null;
  anomalies: string[];
  events: { at: string; type: string; amountCents: number | null; detail: string }[];
};

export type GroupBy = "none" | "shop" | "window" | "decision" | "mandate";

// Full-width rows are how Community AG Grid shows group headers and per-order detail without the Enterprise modules.
export type GridRow =
  | ({ kind: "payment"; group: string } & LedgerRow)
  | { kind: "group"; id: string; group: string; title: string; count: number; paidCents: number; heldCents: number; limitCents: number | null; open: boolean }
  | { kind: "detail"; id: string; group: string; parent: LedgerRow };

export const PAID = new Set(["captured"]);
// The budget stays reserved until a void completes, so a hold being released still counts as held.
export const HELD = new Set(["authorizing", "authorized", "pending_approval", "capturing", "voiding"]);

/**
 * The longest calendar window the mandate budgets (month, then week, then day), so the ledger can group spend by it.
 * Budgets are per mandate, so the window belongs to one mandate.
 */
export function budgetWindow(policy: Policy, at: Date): { window: string; windowLimitCents: number | null } {
  const budget = (["month", "week", "day"] as const).map((period) => policy.budgets.find((b) => b.period === period)).find(Boolean);
  const tz = policy.timezone;
  const month = at.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: tz });
  if (!budget) return { window: month, windowLimitCents: null };
  if (budget.period === "month") return { window: month, windowLimitCents: budget.limitCents };
  const start = windowStart(budget.period, at, tz)!;
  const date = start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
  return { window: budget.period === "week" ? `Week of ${date}` : date, windowLimitCents: budget.limitCents };
}

function group(row: LedgerRow, by: GroupBy, label: (decision: string) => string, mandates: number): { key: string; title: string } {
  if (by === "shop") return { key: row.shop, title: row.shop };
  if (by === "decision") return { key: row.decision, title: label(row.decision) };
  if (by === "mandate") return { key: row.mandateId, title: row.mandateLabel };
  if (by === "window") return { key: `${row.mandateId}|${row.window}`, title: mandates > 1 ? `${row.window} · ${row.mandateLabel}` : row.window };
  return { key: "", title: "" };
}

/** Rows for the grid: optional group headers with totals, each payment, and a detail row under each expanded payment. */
export function buildRows(rows: LedgerRow[], by: GroupBy, closed: Set<string>, expanded: Set<string>, label: (decision: string) => string): GridRow[] {
  const out: GridRow[] = [];
  const push = (row: LedgerRow, key: string) => {
    out.push({ kind: "payment", group: key, ...row });
    if (expanded.has(row.id)) out.push({ kind: "detail", id: `detail:${row.id}`, group: key, parent: row });
  };
  if (by === "none") {
    rows.forEach((r) => push(r, ""));
    return out;
  }
  const mandates = new Set(rows.map((r) => r.mandateId)).size;
  const groups = new Map<string, { title: string; members: LedgerRow[] }>();
  for (const r of rows) {
    const { key, title } = group(r, by, label, mandates);
    const entry = groups.get(key) ?? { title, members: [] };
    entry.members.push(r);
    groups.set(key, entry);
  }
  for (const [key, { title, members }] of groups) {
    const open = !closed.has(key);
    out.push({
      kind: "group",
      id: `group:${key}`,
      group: key,
      title,
      count: members.length,
      paidCents: members.filter((m) => PAID.has(m.status)).reduce((s, m) => s + m.totalCents, 0),
      heldCents: members.filter((m) => HELD.has(m.status)).reduce((s, m) => s + m.totalCents, 0),
      limitCents: by === "window" ? members[0]!.windowLimitCents : null,
      open,
    });
    if (open) members.forEach((m) => push(m, key));
  }
  return out;
}
