"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type IRowNode,
  type PostSortRowsParams,
  type RowClassParams,
  type RowHeightParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo, useState } from "react";
import { buildRows, HELD, PAID, type GridRow, type GroupBy, type LedgerRow } from "@/lib/app/ledger-rows";
import { decisionLabel, StatusPill } from "./ui";

export type { LedgerRow };

ModuleRegistry.registerModules([AllCommunityModule]);

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
  rowHeight: 48,
});

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });


const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "none", label: "No grouping" },
  { id: "shop", label: "Shop" },
  { id: "window", label: "Budget window" },
  { id: "decision", label: "Decision" },
  { id: "mandate", label: "Signed rules" },
];

const FLAG_LABEL: Record<string, string> = {
  payee_mismatch: "PayPal paid a different shop",
  payee_missing: "PayPal didn't report the shop",
  amount_mismatch: "Held amount differs",
  capture_failed: "Capture kept failing",
};

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
  "resume.failed": "Retry didn't go through",
  "capture.unanswered": "PayPal didn't answer the capture",
  "void.unanswered": "PayPal didn't answer the release",
  anomaly: "Anomaly flagged",
};

// Webhook events are stored as "paypal." + PayPal's event type, e.g. paypal.payment.capture.completed.
function eventLabel(type: string): string {
  if (EVENT_LABEL[type]) return EVENT_LABEL[type];
  if (!type.startsWith("paypal.")) return type;
  const words = type.slice("paypal.".length).replace(/^payment\./, "").replace(/^checkout\./, "").split(".").join(" ");
  return `PayPal webhook: ${words}`;
}

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const [by, setBy] = useState<GroupBy>("none");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.shop, r.items, r.rule, decisionLabel(r.decision), r.status, r.window, r.mandateHash, ...r.anomalies].join(" ").toLowerCase().includes(q));
  }, [rows, search]);
  const gridRows = useMemo(() => buildRows(visible, by, closed, expanded, decisionLabel), [visible, by, closed, expanded]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        colId: "open",
        headerName: "",
        width: 52,
        sortable: false,
        resizable: false,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data?.kind === "payment" && !p.node.rowPinned ? (
            <span className="flex h-full items-center text-ink-2" aria-hidden>
              <Chevron open={expanded.has(p.data.id)} />
            </span>
          ) : null,
      },
      { field: "at", headerName: "When (UTC)", valueFormatter: (p) => (p.value ? when(p.value) : ""), width: 150, sort: "desc" },
      { field: "shop", headerName: "Shop", width: 140 },
      { field: "items", headerName: "Items", flex: 1, minWidth: 220 },
      { field: "totalCents", headerName: "Total", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), width: 110, type: "rightAligned" },
      { field: "decision", headerName: "Decision", valueFormatter: (p) => (p.value ? decisionLabel(p.value) : ""), width: 120 },
      {
        field: "status",
        headerName: "Status",
        width: 150,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data?.kind === "payment" && !p.node.rowPinned ? (
            <span className="flex h-full items-center">
              <StatusPill status={p.data.status} />
            </span>
          ) : null,
      },
      {
        field: "anomalies",
        headerName: "Flags",
        width: 130,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data?.kind === "payment" && !p.node.rowPinned && p.data.anomalies.length ? (
            <span className="flex h-full items-center">
              <span className="rounded-full bg-accent px-2.5 py-1 text-[0.78rem] leading-4 font-medium text-paper">{p.data.anomalies.length === 1 ? "1 flag" : `${p.data.anomalies.length} flags`}</span>
            </span>
          ) : null,
      },
      { field: "rule", headerName: "Rule that decided", flex: 1, minWidth: 220 },
      { field: "window", headerName: "Budget window", width: 150 },
      { field: "source", headerName: "From", width: 90, valueFormatter: (p) => (p.value === "mcp" ? "MCP" : p.value === "agent" ? "Agent" : "") },
      { field: "mandateHash", headerName: "Mandate hash", width: 140, valueFormatter: (p) => (p.value ? `${p.value.slice(0, 10)}…` : "") },
    ],
    [expanded],
  );

  const totals = useMemo(() => {
    const sum = (set: Set<string>) => visible.filter((r) => set.has(r.status)).reduce((s, r) => s + r.totalCents, 0);
    const blocked = visible.filter((r) => r.decision === "deny").reduce((s, r) => s + r.totalCents, 0);
    return [
      { kind: "payment", id: "total-paid", shop: "Paid", items: "Captured by the shops", totalCents: sum(PAID) },
      { kind: "payment", id: "total-held", shop: "On hold", items: "Held in PayPal", totalCents: sum(HELD) },
      { kind: "payment", id: "total-blocked", shop: "Blocked", items: "Denied, never charged", totalCents: blocked },
    ] as GridRow[];
  }, [visible]);

  // AG Grid sorts every row it holds; this puts each group's header first and each detail row right under its payment.
  const postSortRows = useCallback(({ nodes }: PostSortRowsParams<GridRow>) => {
    const order: IRowNode<GridRow>[] = [];
    const headers = nodes.filter((n) => n.data?.kind === "group");
    const details = new Map(nodes.filter((n) => n.data?.kind === "detail").map((n) => [(n.data as { parent: LedgerRow }).parent.id, n]));
    const sorted = nodes.filter((n) => n.data?.kind === "payment");
    const place = (group: string) =>
      sorted
        .filter((n) => n.data!.group === group)
        .forEach((n) => {
          order.push(n);
          const detail = details.get(n.data!.id);
          if (detail) order.push(detail);
        });
    if (headers.length) headers.forEach((h) => (order.push(h), place(h.data!.group)));
    else place("");
    nodes.splice(0, nodes.length, ...order);
  }, []);

  const height = (rowCount: number) => (rowCount > 14 ? "h-160" : "");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Group payments by" className="flex flex-wrap gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={by === g.id}
              onClick={() => {
                setBy(g.id);
                setClosed(new Set());
              }}
              className={`h-9 rounded-full border px-3.5 text-[0.9rem] font-medium ${by === g.id ? "border-ink bg-ink text-paper" : "border-line-strong hover:border-ink"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="flex h-9 w-full items-center gap-2 rounded-full border border-line-strong px-3.5 sm:w-64">
          <span className="sr-only">Search payments</span>
          <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-ink-2" aria-hidden>
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shop, item, rule, flag" className="w-full bg-transparent text-[0.9rem] focus:outline-none" />
        </label>
      </div>

      <div className={`min-w-0 ${height(gridRows.length)}`}>
        <AgGridReact<GridRow>
          theme={theme}
          rowData={gridRows}
          getRowId={(p) => p.data.id}
          domLayout={gridRows.length > 14 ? "normal" : "autoHeight"}
          rowHeight={48}
          columnDefs={columns}
          pinnedBottomRowData={totals}
          defaultColDef={{ sortable: true, resizable: true }}
          postSortRows={postSortRows}
          isFullWidthRow={({ rowNode }) => rowNode.data?.kind === "group" || rowNode.data?.kind === "detail"}
          fullWidthCellRenderer={(p: ICellRendererParams<GridRow>) =>
            p.data?.kind === "group" ? (
              <GroupHeader row={p.data} onToggle={() => setClosed((s) => toggle(s, (p.data as { group: string }).group))} />
            ) : p.data?.kind === "detail" ? (
              <Detail row={p.data.parent} />
            ) : null
          }
          getRowHeight={({ data }: RowHeightParams<GridRow>) => (data?.kind === "detail" ? 64 + Math.ceil(data.parent.events.length / 3) * 56 + (data.parent.anomalies.length ? 30 : 0) : data?.kind === "group" ? 52 : 48)}
          getRowClass={({ data, node }: RowClassParams<GridRow>) => (node.rowPinned ? "font-semibold" : data?.kind === "payment" ? "cursor-pointer" : "")}
          suppressCellFocus
          onRowClicked={(e) => {
            if (e.node.rowPinned || e.data?.kind !== "payment") return;
            const id = e.data.id;
            setExpanded((s) => toggle(s, id));
          }}
          overlayNoRowsTemplate={search ? "No payment matches that search." : "No payments yet. Send the agent shopping from the Shop page."}
        />
      </div>
      <p className="text-[0.88rem] text-ink-2">Click a payment for its full trail: the decision, the PayPal hold, your answer, and the capture or void.</p>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="m7.5 5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GroupHeader({ row, onToggle }: { row: Extract<GridRow, { kind: "group" }>; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={row.open} className="flex size-full items-center gap-3 bg-paper-2 px-4 text-left">
      <Chevron open={row.open} />
      <span className="font-semibold tracking-[-0.01em]">{row.title}</span>
      <span className="text-[0.88rem] text-ink-2">{row.count === 1 ? "1 payment" : `${row.count} payments`}</span>
      <span className="ml-auto flex items-center gap-4 text-[0.88rem]">
        <span>
          <span className="text-ink-2">Paid </span>
          <span className="font-medium">{money(row.paidCents)}</span>
        </span>
        {row.heldCents > 0 && (
          <span>
            <span className="text-ink-2">Held </span>
            <span className="font-medium">{money(row.heldCents)}</span>
          </span>
        )}
        {row.limitCents !== null && (
          <span className="hidden items-center gap-2 sm:flex">
            <span className="text-ink-2">of {money(row.limitCents)}</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-3">
              <span className="block h-full bg-ink" style={{ width: `${Math.min(100, ((row.paidCents + row.heldCents) / row.limitCents) * 100)}%` }} />
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

function Detail({ row }: { row: LedgerRow }) {
  return (
    <div className="size-full overflow-hidden border-y border-line bg-paper-2 px-6 py-4 whitespace-normal">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold tracking-[-0.01em]">
          {row.shop} · {money(row.totalCents)} · {row.items}
        </p>
        <p className="font-mono text-[0.72rem] text-ink-3">mandate sha256 {row.mandateHash.slice(0, 24)}…</p>
      </div>
      {row.anomalies.length > 0 && (
        <p className="mt-2 text-[0.9rem] font-medium text-accent-ink">Flagged, so never captured: {row.anomalies.map((a) => FLAG_LABEL[a] ?? a).join("; ")}.</p>
      )}
      <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        {row.events.map((e, i) => (
          <li key={i} className="border-l-2 border-line-strong pl-3">
            <p className="text-[0.9rem] leading-5 font-medium">{eventLabel(e.type)}</p>
            <p className="text-[0.8rem] leading-5 text-ink-2">
              {when(e.at)}
              {e.amountCents != null ? ` · ${money(e.amountCents)}` : ""}
            </p>
            {e.detail && <p className="truncate font-mono text-[0.7rem] leading-4 text-ink-3">{e.detail}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
