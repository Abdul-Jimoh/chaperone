import type { ReactNode } from "react";

/** The landing page's container, so the app lines up with it. */
export const SHELL = "mx-auto w-full max-w-[1680px] px-5 sm:px-8";

const STATUS: Record<string, { label: string; tone: string }> = {
  captured: { label: "Paid", tone: "bg-mint text-go" },
  pending_approval: { label: "Waiting for you", tone: "bg-accent text-paper" },
  authorized: { label: "Held", tone: "bg-paper-3 text-ink" },
  authorizing: { label: "Processing", tone: "bg-paper-3 text-ink-2" },
  capturing: { label: "Processing", tone: "bg-paper-3 text-ink-2" },
  voiding: { label: "Cancelling", tone: "bg-paper-3 text-ink-2" },
  voided: { label: "Cancelled", tone: "bg-paper-3 text-ink-2" },
  denied: { label: "Blocked", tone: "bg-ink text-paper" },
  failed: { label: "Failed", tone: "bg-ink text-paper" },
};

const DECISION: Record<string, string> = { allow: "Allowed", needs_approval: "Ask you", deny: "Denied" };

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "bg-paper-3 text-ink" };
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[0.8rem] leading-4 font-medium ${s.tone}`}>{s.label}</span>;
}

export function decisionLabel(decision: string): string {
  return DECISION[decision] ?? decision;
}

export function Card({ title, label, children, className = "", action }: { title?: string; label?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-[1.4rem] border border-line-strong bg-paper p-5 sm:p-6 ${className}`}>
      {(title || label || action) && (
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            {label && <p className="label text-ink-2">{label}</p>}
            {title && <h2 className="mt-1.5 text-[1.35rem] font-semibold tracking-[-0.03em]">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-paper-3" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <div className={`h-full rounded-full ${pct >= 90 ? "bg-accent" : "bg-ink"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
