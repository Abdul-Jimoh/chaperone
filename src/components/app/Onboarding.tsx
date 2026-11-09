"use client";

import { useState, useTransition } from "react";
import { compileRules, exampleRules, type CompileResponse } from "@/app/app/actions";
import type { ReadBack } from "@/lib/app/demo";
import type { Wallet } from "@/lib/app/wallet";
import { ConfirmForm } from "./ConfirmForm";
import { LinkPayPal } from "./LinkPayPal";
import { Card, SHELL } from "./ui";

export function Onboarding({ example, wallet }: { example: string; wallet: Wallet }) {
  const [statement, setStatement] = useState(example);
  const [draft, setDraft] = useState<ReadBack | null>(null);
  const [failure, setFailure] = useState<Exclude<CompileResponse, { ok: true }> | null>(null);
  const [pending, start] = useTransition();

  const compile = () =>
    start(async () => {
      const result = await compileRules(statement);
      if (result.ok) {
        setDraft(result);
        setFailure(null);
      } else {
        setFailure(result);
      }
    });
  const fallBack = () =>
    start(async () => {
      const result = await exampleRules();
      setStatement(result.statement);
      setDraft(result);
      setFailure(null);
    });

  return (
    <div className={`${SHELL} py-12 lg:py-16`}>
      <p className="label text-ink-2">Set up</p>
      <h1 className="display mt-4 max-w-4xl text-[clamp(2.2rem,5vw,4.4rem)]">Write your rules. Check them. Sign them.</h1>

      <div className="mt-10 grid gap-4 lg:mt-14 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-5">
          <Card label="Step 1" title={wallet.kind === "none" ? "Link PayPal" : "PayPal is linked"}>
            <LinkPayPal wallet={wallet} />
          </Card>

          <Card label="Step 2" title="Your rules, in your words">
            <label htmlFor="statement" className="sr-only">
              Your rules
            </label>
            <textarea
              id="statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={600}
              rows={5}
              className="w-full resize-y rounded-xl border border-line-strong bg-paper-2 p-4 text-[1.1rem] leading-snug tracking-[-0.01em] focus:border-ink focus:outline-none"
            />
            <p className="mt-2 text-[0.88rem] text-ink-2">
              Change a limit or the shops if you like. The shops are Corner Market, Pet Pantry and Home Basics.
            </p>
            <button
              type="button"
              onClick={compile}
              disabled={pending}
              className="mt-4 inline-flex h-11 items-center rounded-full bg-ink px-5 font-medium text-paper hover:bg-accent disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Claude is reading your rules…" : draft ? "Turn into rules again" : "Turn into rules"}
            </button>
            {failure && (
              <div role="alert" className="mt-4 rounded-xl bg-paper-2 p-4 text-[0.95rem]">
                {"error" in failure ? (
                  <p className="text-accent-ink">{failure.error}</p>
                ) : (
                  <ul className="space-y-1 text-accent-ink">
                    {failure.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {"example" in failure && failure.example && (
                  <button type="button" onClick={fallBack} disabled={pending} className="mt-3 font-medium underline underline-offset-4 hover:text-accent-ink">
                    Use the example&apos;s rules instead (compiled by Claude earlier)
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card label="Step 3" title="What Chaperone will enforce" className="lg:col-span-7">
          {draft ? (
            <>
              <p className="mb-4 leading-relaxed text-ink-2">Claude read your sentence as these rules. Check them: this is exactly what gets signed and checked on every purchase.</p>
              <ul className="divide-y divide-line border-y border-line">
                {draft.rules.map((line) => (
                  <li key={line} className="flex gap-3 py-3.5">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              {draft.notEnforced.length > 0 && (
                <div className="mt-4 rounded-xl bg-paper-2 p-4 text-[0.95rem]">
                  <p className="font-medium">Not enforced</p>
                  <p className="mt-1 text-ink-2">Chaperone has no rule for these, so they won&apos;t be checked: {draft.notEnforced.join("; ")}.</p>
                </div>
              )}
              <ConfirmForm draft={draft.token} stale={statement.trim() !== draft.statement} />
            </>
          ) : (
            <p className="leading-relaxed text-ink-2">
              Press <span className="font-medium text-ink">Turn into rules</span>. Claude drafts the rules from your sentence and they appear here for you
              to check. Claude never decides a payment; it only drafts the rules you sign.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
