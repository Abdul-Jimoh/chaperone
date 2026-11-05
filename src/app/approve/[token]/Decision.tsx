"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/app/SubmitButton";
import { decide, type DecideResult } from "./actions";

const OUTCOME: Record<string, { title: string; body: string }> = {
  captured: { title: "Approved and paid.", body: "The hold was captured. The shop has been paid." },
  voided: { title: "Rejected. Nothing was charged.", body: "The hold was cancelled and the money went back into your budget." },
};

export function Decision({ token, deadline, fromDashboard }: { token: string; deadline: string; fromDashboard: boolean }) {
  const [result, action, pending] = useActionState<DecideResult | null, FormData>(decide, null);
  const router = useRouter();
  const decided = result?.ok === true;

  useEffect(() => {
    if (!decided || !fromDashboard) return;
    const timer = window.setTimeout(() => router.replace("/app"), 2500);
    return () => window.clearTimeout(timer);
  }, [decided, fromDashboard, router]);

  if (result?.ok) {
    const o = OUTCOME[result.status] ?? { title: "Recorded.", body: `Status: ${result.status}.` };
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-ink p-6 text-paper" role="status">
          <p className="text-[1.6rem] font-semibold tracking-[-0.03em]">{o.title}</p>
          <p className="mt-2 text-paper/75">{o.body}</p>
        </div>
        {fromDashboard ? (
          <p className="text-ink-2">
            Taking you back to your dashboard…{" "}
            <Link href="/app" replace className="font-medium text-ink underline underline-offset-4">
              Go now
            </Link>
          </p>
        ) : (
          <p className="text-ink-2">You can close this page. Your dashboard has already updated.</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="choice" value="approve" />
        <SubmitButton pending="Approving…" disabled={pending} className="h-14 w-full text-[1.1rem]">
          Approve and pay
        </SubmitButton>
      </form>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="choice" value="reject" />
        <SubmitButton variant="secondary" pending="Rejecting…" disabled={pending} className="h-14 w-full text-[1.1rem]">
          Reject
        </SubmitButton>
      </form>
      {result?.ok === false && <p className="text-center text-accent-ink">{result.error}</p>}
      <p className="label pt-3 text-center text-ink-3">If you don&apos;t answer, it cancels itself at {deadline} UTC</p>
    </div>
  );
}
