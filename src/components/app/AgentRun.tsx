"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentStep } from "@/lib/agent/run";
import { decisionLabel, StatusPill } from "./ui";

type Event = { type: "step"; step: AgentStep } | { type: "done"; summary: string } | { type: "error"; message: string };

function Step({ step }: { step: AgentStep }) {
  if (step.kind === "search") {
    return (
      <p className="text-ink-2">
        Searched the shops for <span className="text-ink">&ldquo;{step.query}&rdquo;</span> · {step.found} {step.found === 1 ? "listing" : "listings"}
      </p>
    );
  }
  if (step.kind === "payment") {
    return (
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="font-medium">
            {decisionLabel(step.decision)} · {step.shop} · {step.total}
          </p>
          <p className="text-[0.88rem] text-ink-2">Rule: {step.rule}</p>
        </div>
        <StatusPill status={step.status} />
      </div>
    );
  }
  return <p className="text-[0.92rem] text-ink-3">Chaperone turned down a request: {step.message}</p>;
}

export function AgentRun({ example, attempt }: { example: string; attempt: string }) {
  const router = useRouter();
  const [goal, setGoal] = useState(example);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [attemptId, setAttemptId] = useState(attempt);

  async function run() {
    setRunning(true);
    setSteps([]);
    setSummary(null);
    setError(null);
    try {
      const response = await fetch("/api/demo/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, attempt: attemptId }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "The agent couldn't start.");
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as Event;
          if (event.type === "step") {
            setSteps((s) => [...s, event.step]);
            if (event.step.kind === "payment") router.refresh();
          } else if (event.type === "done") setSummary(event.summary);
          else setError(event.message);
        }
      }
    } catch {
      setError("Lost the connection to the agent. Anything it bought is listed under Activity.");
    } finally {
      setRunning(false);
      setAttemptId(crypto.randomUUID());
      router.refresh();
    }
  }

  return (
    <div>
      <label htmlFor="goal" className="sr-only">
        What should the agent buy?
      </label>
      <textarea
        id="goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        maxLength={300}
        rows={2}
        className="w-full resize-y rounded-xl border border-line-strong bg-paper-2 p-4 leading-snug focus:border-ink focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || goal.trim().length < 5}
          className="inline-flex h-11 items-center rounded-full bg-ink px-5 font-medium text-paper hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          {running ? "Shopping…" : steps.length ? "Send it shopping again" : "Send the agent shopping"}
        </button>
        <p className="text-[0.88rem] text-ink-2">Claude searches Corner Market, Pet Pantry and Home Basics, then asks Chaperone to pay.</p>
      </div>

      <div aria-live="polite" className="mt-5 space-y-3">
        {(running || steps.length > 0 || summary || error) && (
          <ol className="space-y-3 border-l border-line-strong pl-4">
            {steps.map((step, i) => (
              <li key={i}>
                <Step step={step} />
              </li>
            ))}
            {running && (
              <li className="relative overflow-hidden rounded-xl bg-paper-2 p-3">
                <p className="text-ink-2">{steps.length ? "Claude is working on the next step…" : "Claude is reading your rules and starting to search…"}</p>
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-paper-3">
                  <span className="block h-full w-1/4 animate-progress bg-ink motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-ink-3" />
                </span>
              </li>
            )}
          </ol>
        )}
        {summary && (
          <div className="rounded-xl bg-paper-2 p-4">
            <p className="label text-ink-2">Claude&apos;s summary</p>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{summary}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-paper-2 p-4 text-accent-ink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
