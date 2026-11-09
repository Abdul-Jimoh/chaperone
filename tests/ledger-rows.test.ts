import { describe, expect, it } from "vitest";
import { budgetWindow, buildRows, type LedgerRow } from "@/lib/app/ledger-rows";
import type { Policy } from "@/lib/policy/schema";

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: over.id ?? "p1",
  at: "2026-11-08T12:00:00Z",
  shop: "Pet Pantry",
  items: "1× Dog food",
  totalCents: 1000,
  decision: "allow",
  rule: "",
  status: "captured",
  source: "agent",
  mandateId: "m1",
  mandateHash: "h",
  mandateLabel: "Signed Nov 8 · aaaa",
  window: "November 2026",
  windowLimitCents: 15_000,
  anomalies: [],
  events: [],
  ...over,
});
const label = (d: string) => d;
const groups = (rows: ReturnType<typeof buildRows>) => rows.flatMap((r) => (r.kind === "group" ? [r] : []));

describe("ledger rows", () => {
  it("keeps each mandate's budget window apart, since budgets are per mandate", () => {
    const rows = [row({ id: "a", mandateId: "m1", windowLimitCents: 15_000 }), row({ id: "b", mandateId: "m2", mandateLabel: "Signed Nov 9 · bbbb", windowLimitCents: 5_000 })];
    const g = groups(buildRows(rows, "window", new Set(), new Set(), label));
    expect(g.map((x) => [x.limitCents, x.count])).toEqual([
      [15_000, 1],
      [5_000, 1],
    ]);
    expect(g[1]!.title).toBe("November 2026 · Signed Nov 9 · bbbb");
  });

  it("counts a hold being released as held until the void completes", () => {
    const rows = [row({ id: "a", status: "voiding" }), row({ id: "b", status: "pending_approval" }), row({ id: "c", status: "voided" }), row({ id: "d", status: "captured" })];
    const [g] = groups(buildRows(rows, "shop", new Set(), new Set(), label));
    expect([g!.heldCents, g!.paidCents]).toEqual([2000, 1000]);
  });

  it("puts a detail row right under an expanded payment and hides a closed group's rows", () => {
    const rows = [row({ id: "a" }), row({ id: "b", shop: "Home Basics" })];
    const built = buildRows(rows, "shop", new Set(["Home Basics"]), new Set(["a"]), label);
    expect(built.map((r) => r.id)).toEqual(["group:Pet Pantry", "a", "detail:a", "group:Home Basics"]);
  });

  it("names the window after the mandate's longest calendar budget, with the year", () => {
    const policy = { timezone: "UTC", budgets: [{ period: "week", limitCents: 5_000 }] } as unknown as Policy;
    expect(budgetWindow(policy, new Date("2026-11-11T10:00:00Z"))).toEqual({ window: "Week of Nov 9, 2026", windowLimitCents: 5_000 });
  });
});
