"use client";

import { useActionState, useState } from "react";
import { simulate, type SimulateResult } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";
import { decisionLabel, StatusPill } from "./ui";

export type ScenarioCard = { id: string; noun: string; title: string; body: string; expect: string };

export function Simulator({ disabled, attempt, scenarios, stacked = false }: { disabled: boolean; attempt: string; scenarios: ScenarioCard[]; stacked?: boolean }) {
  const [result, action, pending] = useActionState<SimulateResult | null, FormData>(simulate, null);
  // Pinned so a background refresh of the page can't swap the attempt id between two clicks.
  const [firstAttempt] = useState(attempt);
  const [trying, setTrying] = useState<ScenarioCard | null>(null);

  return (
    <div>
      <div className={`grid gap-3 ${stacked ? "" : "md:grid-cols-3"}`}>
        {scenarios.map((s) => (
          <form key={s.id} action={action} onSubmit={() => setTrying(s)} className="flex flex-col justify-between gap-4 rounded-2xl border border-line p-4">
            <input type="hidden" name="scenario" value={s.id} />
            <input type="hidden" name="attempt" value={result?.nextAttempt ?? firstAttempt} />
            <div>
              <h3 className="font-semibold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-2">{s.body}</p>
              <p className="label mt-3 text-ink-3">{s.expect}</p>
            </div>
            <SubmitButton variant="secondary" pending="Checking…" disabled={disabled || pending} className="w-full">
              Send this cart
            </SubmitButton>
          </form>
        ))}
      </div>
      <div aria-live="polite" className="mt-4 min-h-14">
        {pending && trying ? (
          <div className="relative overflow-hidden rounded-xl bg-paper-2 p-4">
            <p>
              <span className="font-semibold">Checking {trying.noun}</span>
              <span className="text-ink-2"> · against your rules first, then PayPal places the hold if they allow it</span>
            </p>
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-paper-3">
              <span className="block h-full w-1/4 animate-progress bg-ink motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-ink-3" />
            </span>
          </div>
        ) : (
          <>
            {result?.ok === false && <p className="rounded-xl bg-paper-2 p-4 text-accent-ink">{result.error}</p>}
            {result?.ok && (
              <div className={`flex flex-col gap-2 rounded-xl p-4 ${stacked ? "bg-paper" : "bg-paper-2 sm:flex-row sm:items-center sm:justify-between"}`}>
                <p>
                  <span className="font-semibold">{decisionLabel(result.decision)}</span>
                  <span className="text-ink-2">
                    {" "}
                    · {result.shop} · {result.total} · {result.rule}
                  </span>
                </p>
                <StatusPill status={result.status} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
