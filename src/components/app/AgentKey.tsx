"use client";

import { useState, useTransition } from "react";
import { createAgentKey } from "@/app/app/actions";

export function AgentKey({ disabled }: { disabled: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (key) {
    return (
      <div className="space-y-3">
        <p className="text-[0.92rem] text-ink-2">Copy it now; it won&apos;t be shown again. Only its hash is stored.</p>
        <pre className="overflow-x-auto rounded-xl bg-night p-4 font-mono text-[0.78rem] leading-relaxed text-paper">{`{
  "mcpServers": {
    "chaperone": {
      "url": "${typeof window === "undefined" ? "" : window.location.origin}/api/mcp",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`}</pre>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const r = await createAgentKey();
            if (r.ok) setKey(r.key);
            else setError(r.error);
          })
        }
        className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 font-medium hover:border-ink disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create an agent key"}
      </button>
      {error && <p className="mt-2 text-[0.92rem] text-accent-ink">{error}</p>}
    </div>
  );
}
