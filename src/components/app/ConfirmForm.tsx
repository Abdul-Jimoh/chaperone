"use client";

import { useActionState } from "react";
import { confirmMandate } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";

export function ConfirmForm({ draft, stale }: { draft: string; stale: boolean }) {
  const [state, action] = useActionState<{ error: string } | null, FormData>(confirmMandate, null);
  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="draft" value={draft} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.92rem] text-ink-2">
          {stale
            ? "You've changed your sentence since this read-back. Turn it into rules again before signing."
            : "Nothing takes effect until you confirm. Then these exact rules are signed and stored with their hash."}
        </p>
        <SubmitButton pending="Signing…" disabled={stale}>
          Confirm and sign
        </SubmitButton>
      </div>
      {state?.error && (
        <p role="alert" className="mt-3 text-accent-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
