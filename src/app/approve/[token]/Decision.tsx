"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/app/SubmitButton";
import { decide, type DecideResult } from "./actions";

const OUTCOME: Record<string, { title: string; body: string }> = {
  captured: { title: "Approved and paid.", body: "The hold was captured. The shop has been paid." },
  voided: { title: "Rejected. Nothing was charged.", body: "The hold was cancelled and the money went back into your budget." },
};

export function Decision({ token, deadline }: { token: string; deadline: string }) {
  const [result, action] = useActionState<DecideResult | null, FormData>(decide, null);

  if (result?.ok) {
    const o = OUTCOME[result.status] ?? { title: "Recorded.", body: `Status: ${result.status}.` };
    return (
      <div className="rounded-2xl bg-ink p-6 text-paper" role="status">
        <p className="text-[1.6rem] font-semibold tracking-[-0.03em]">{o.title}</p>
        <p className="mt-2 text-paper/75">{o.body}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="choice" value="approve" />
        <SubmitButton pending="Approving…" className="h-14 w-full text-[1.1rem]">
          Approve and pay
        </SubmitButton>
      </form>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="choice" value="reject" />
        <SubmitButton variant="secondary" pending="Rejecting…" className="h-14 w-full text-[1.1rem]">
          Reject
        </SubmitButton>
      </form>
      {result?.ok === false && <p className="text-center text-accent-ink">{result.error}</p>}
      <p className="label pt-3 text-center text-ink-3">If you don&apos;t answer, it cancels itself at {deadline} UTC</p>
    </div>
  );
}
