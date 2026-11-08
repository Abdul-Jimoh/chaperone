"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { decisionLabel, StatusPill } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

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
  mandateHash: string;
  anomalies: string[];
  events: { at: string; type: string; amountCents: number | null; detail: string }[];
};

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  backgroundColor: "#ece9e3",
  foregroundColor: "#121211",
  headerBackgroundColor: "#e3dfd7",
  headerTextColor: "#55524c",
  borderColor: "rgb(18 18 17 / 0.14)",
  rowHoverColor: "#e3dfd7",
  selectedRowBackgroundColor: "#d6d1c6",
  accentColor: "#e8572a",
  oddRowBackgroundColor: "#ece9e3",
  headerFontWeight: 500,
  wrapperBorderRadius: 16,
  fontSize: 14,
});

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

const EVENT_LABEL: Record<string, string> = {
  "decision.allow": "Evaluator: allowed",
  "decision.needs_approval": "Evaluator: ask the user",
  "decision.deny": "Evaluator: denied",
  "hold.placed": "PayPal hold placed",
  "hold.failed": "PayPal hold failed",
  "hold.voided": "Hold cancelled",
  "approval.requested": "Waiting for the user",
  "approval.approved": "User approved",
  "approval.rejected": "User rejected",
  "approval.expired": "No answer: timed out",
  "capture.completed": "Captured: shop paid",
  "capture.failed": "Capture failed",
  "void.failed": "Cancelling the hold failed",
  anomaly: "Anomaly flagged",
};

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const [selected, setSelected] = useState<LedgerRow | null>(null);

  const columns = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "at", headerName: "When (UTC)", valueFormatter: (p) => (p.value ? when(p.value) : ""), width: 150, sort: "desc" },
      { field: "shop", headerName: "Shop", width: 150 },
      { field: "items", headerName: "Items", flex: 1, minWidth: 220 },
      { field: "totalCents", headerName: "Total", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), width: 110, type: "rightAligned" },
      { field: "decision", headerName: "Decision", valueFormatter: (p) => (p.value ? decisionLabel(p.value) : ""), width: 120 },
      {
        field: "status",
        headerName: "Status",
        width: 160,
        cellRenderer: (p: ICellRendererParams<LedgerRow>) =>
          p.data && !p.node.rowPinned ? (
            <span className="flex h-full items-center">
              <StatusPill status={p.value} />
            </span>
          ) : null,
      },
      { field: "rule", headerName: "Rule that decided", flex: 1, minWidth: 220 },
      { field: "source", headerName: "From", width: 90, valueFormatter: (p) => (p.value === "mcp" ? "MCP" : p.value === "agent" ? "Agent" : "") },
      { field: "mandateHash", headerName: "Mandate hash", width: 140, valueFormatter: (p) => (p.value ? `${p.value.slice(0, 10)}…` : "") },
      { field: "anomalies", headerName: "Flags", width: 120, valueFormatter: (p) => (p.value?.length ? p.value.join(", ") : "") },
    ],
    [],
  );

  const paid = rows.filter((r) => r.status === "captured").reduce((sum, r) => sum + r.totalCents, 0);
  const pinned = useMemo(() => [{ shop: "Paid in total", totalCents: paid } as LedgerRow], [paid]);

  return (
    <div className="grid gap-4">
      <div className={`min-w-0 ${rows.length > 12 ? "h-136" : ""}`}>
        <AgGridReact<LedgerRow>
          theme={theme}
          rowData={rows}
          domLayout={rows.length > 12 ? "normal" : "autoHeight"}
          rowHeight={48}
          columnDefs={columns}
          pinnedBottomRowData={pinned}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
          onRowClicked={(e) => !e.node.rowPinned && e.data && setSelected(e.data)}
          overlayNoRowsTemplate="No payments yet. Send the agent shopping from the Shop page."
        />
      </div>
      <aside className="rounded-[1.4rem] border border-line-strong p-5" aria-live="polite">
        {selected ? (
          <>
            <p className="label text-ink-2">Payment trail</p>
            <p className="mt-2 text-[1.2rem] font-semibold tracking-[-0.02em]">
              {selected.shop} · {money(selected.totalCents)}
            </p>
            <ol className="mt-4 space-y-3 border-l border-line-strong pl-4">
              {selected.events.map((e, i) => (
                <li key={i}>
                  <p className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</p>
                  <p className="text-[0.85rem] text-ink-2">
                    {when(e.at)}
                    {e.amountCents != null ? ` · ${money(e.amountCents)}` : ""}
                  </p>
                  {e.detail && <p className="mt-0.5 font-mono text-[0.72rem] break-all text-ink-3">{e.detail}</p>}
                </li>
              ))}
            </ol>
            <p className="mt-4 font-mono text-[0.72rem] break-all text-ink-3">mandate sha256 {selected.mandateHash}</p>
          </>
        ) : (
          <p className="text-ink-2">Select a payment to see every step: the decision, the PayPal hold, your answer, and the capture or void.</p>
        )}
      </aside>
    </div>
  );
}
