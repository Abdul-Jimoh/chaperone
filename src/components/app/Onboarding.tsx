import { describePolicy } from "@/lib/policy/describe";
import type { Policy } from "@/lib/policy/schema";
import { ConfirmForm } from "./ConfirmForm";
import { Card } from "./ui";

export function Onboarding({ statement, policy }: { statement: string; policy: Policy }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 lg:py-16">
      <p className="label text-ink-2">Set up</p>
      <h1 className="display mt-4 text-[clamp(2.2rem,5vw,3.6rem)]">Check your rules, then sign them.</h1>

      <div className="mt-10 space-y-4">
        <Card label="Step 1" title="PayPal is linked">
          <p className="flex items-start gap-3 leading-relaxed text-ink-2">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-mint text-go" aria-hidden>
              ✓
            </span>
            This demo uses a PayPal sandbox buyer whose wallet is already saved, so the agent can pay while you&apos;re away. Every payment
            still needs your rules to pass.
          </p>
        </Card>

        <Card label="Step 2" title="Your rules, in your words">
          <blockquote className="text-[1.25rem] leading-snug font-medium tracking-[-0.02em]">“{statement}”</blockquote>
        </Card>

        <Card label="Step 3" title="What Chaperone will enforce">
          <p className="mb-4 leading-relaxed text-ink-2">Claude turned your sentence into these exact rules. Read them; this is what every purchase is checked against.</p>
          <ul className="divide-y divide-line border-y border-line">
            {describePolicy(policy).map((line) => (
              <li key={line} className="flex gap-3 py-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <ConfirmForm />
        </Card>
      </div>
    </div>
  );
}
