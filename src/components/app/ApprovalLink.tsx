"use client";

import { useState, useTransition } from "react";
import { approvalLink, type LinkResult } from "@/app/app/actions";

export function ApprovalLink({ paymentId }: { paymentId: string }) {
  const [link, setLink] = useState<LinkResult | null>(null);
  const [pending, start] = useTransition();

  if (link?.ok) {
    return (
      <div className="mt-4 flex flex-col gap-4 rounded-xl bg-paper-2 p-4 sm:flex-row sm:items-center">
        <div className="size-32 shrink-0 rounded-lg bg-paper p-2.5 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: link.qr }} aria-label="QR code for the approval link" role="img" />
        <div className="min-w-0 text-[0.92rem]">
          <p className="font-medium">Scan with your phone, or open it here.</p>
          <p className="mt-1 text-ink-2">The link works once and expires in 30 minutes.</p>
          <a href={link.url} className="mt-3 inline-flex h-10 items-center rounded-full bg-ink px-4 text-paper hover:bg-accent">
            Open approval page
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setLink(await approvalLink(paymentId)))}
        className="inline-flex h-10 items-center rounded-full bg-accent px-4 font-medium text-paper hover:bg-accent-ink disabled:opacity-60"
      >
        {pending ? "Creating link…" : "Approve on my phone"}
      </button>
      {link?.ok === false && <p className="mt-2 text-[0.92rem] text-accent-ink">{link.error}</p>}
    </div>
  );
}
