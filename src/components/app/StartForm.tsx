"use client";

import { useActionState } from "react";
import { startDemo } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";

export function StartForm() {
  const [state, action] = useActionState<{ error: string } | null, FormData>(startDemo, null);
  return (
    <form action={action} className="mt-12">
      <SubmitButton pending="Setting up your demo…" className="h-12 px-7 text-[1.02rem]">
        Start the demo <span aria-hidden>→</span>
      </SubmitButton>
      {state?.error && (
        <p role="alert" className="mt-4 text-accent-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
