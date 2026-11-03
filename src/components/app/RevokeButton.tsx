"use client";

import { useState } from "react";
import { revoke } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";

export function RevokeButton() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-11 items-center rounded-full border border-accent px-5 font-medium text-accent-ink hover:bg-accent hover:text-paper">
        Revoke this mandate
      </button>
    );
  }
  return (
    <form action={revoke} className="rounded-xl bg-paper-2 p-4">
      <p className="text-[0.95rem]">Open holds will be cancelled and every later request denied. This can&apos;t be undone.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SubmitButton variant="danger" pending="Revoking…">
          Yes, revoke
        </SubmitButton>
        <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-full px-4 text-ink-2 hover:text-ink">
          Keep it
        </button>
      </div>
    </form>
  );
}
