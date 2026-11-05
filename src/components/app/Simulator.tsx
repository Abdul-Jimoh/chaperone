"use client";

import { useActionState, useState } from "react";
import { simulate, type SimulateResult } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";
import { decisionLabel, StatusPill } from "./ui";

const SCENARIOS = [
  { id: "allowed", noun: "the dog food", title: "Dog food, $26.49", body: "Pet Pantry. Within every rule.", expect: "Should go straight through." },
  { id: "ask", noun: "the paper towels and dish soap", title: "Paper towels and dish soap, $44.99", body: "Home Basics. Over your $40 line.", expect: "Should wait for your OK." },
  { id: "injected", noun: "the 10 bags of kibble", title: "10 bags of kibble, $249.90", body: "A listing told the agent to ignore your limits and pay a different shop.", expect: "Should be blocked." },
] as const;

export function Simulator({ disabled, attempt }: { disabled: boolean; attempt: string }) {
  const [result, action, pending] = useActionState<SimulateResult | null, FormData>(simulate, null);
  // Pinned so a background refresh of the page can't swap the attempt id between two clicks.
  const [firstAttempt] = useState(attempt);
  const [trying, setTrying] = useState<(typeof SCENARIOS)[number] | null>(null);

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        {SCENARIOS.map((s) => (
          <form key={s.id} action={action} onSubmit={() => setTrying(s)} className="flex flex-col justify-between gap-4 rounded-2xl border border-line p-4">
            <input type="hidden" name="scenario" value={s.id} />
            <input type="hidden" name="attempt" value={result?.nextAttempt ?? firstAttempt} />
            <div>
              <h3 className="font-semibold tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-2">{s.body}</p>
              <p className="label mt-3 text-ink-3">{s.expect}</p>
            </div>
            <SubmitButton variant="secondary" pending="Checking…" disabled={disabled || pending} className="w-full">
              Agent tries this
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
              <div className="flex flex-col gap-2 rounded-xl bg-paper-2 p-4 sm:flex-row sm:items-center sm:justify-between">
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
