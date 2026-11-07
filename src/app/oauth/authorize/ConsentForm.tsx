"use client";

import { useActionState } from "react";
import { allowConnect, cancelConnect } from "./actions";

export function ConsentForm({ params }: { params: Record<string, string> }) {
  const [state, action, pending] = useActionState<{ error: string } | null, FormData>(allowConnect, null);
  const hidden = Object.entries(params).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={action}>
          {hidden}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-ink px-7 font-medium text-paper hover:bg-accent disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Connecting…" : "Allow"}
          </button>
        </form>
        <form action={cancelConnect}>
          {hidden}
          <button type="submit" disabled={pending} className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line-strong px-7 font-medium hover:border-ink sm:w-auto">
            Cancel
          </button>
        </form>
      </div>
      {state?.error && (
        <p role="alert" className="mt-4 text-accent-ink">
          {state.error}
        </p>
      )}
    </div>
  );
}
