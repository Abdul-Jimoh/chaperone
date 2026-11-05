"use client";

import { useState, useTransition } from "react";
import { createAgentKey } from "@/app/app/actions";

const TOOLS = [
  ["check_mandate", "reads your rules, shops and what's left to spend"],
  ["request_payment", "asks to pay a shop for a cart"],
  ["list_spend", "lists what it has bought"],
  ["revoke_mandate", "stops itself, for good"],
] as const;

const EXAMPLE = "Check my Chaperone mandate, then buy one 12 kg bag of dry dog food from Pet Pantry.";

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl bg-night text-paper">
      <div className="flex items-center justify-between gap-3 border-b border-night-line px-4 py-2">
        <span className="label text-paper/60">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-full px-2.5 py-1 text-[0.8rem] text-paper/80 hover:bg-night-2 hover:text-paper"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap wrap-anywhere">{text}</pre>
    </div>
  );
}

export function AgentKey({ disabled }: { disabled: boolean }) {
  const [created, setCreated] = useState<{ key: string; endpoint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (created) {
    const { key, endpoint } = created;
    const json = JSON.stringify({ mcpServers: { chaperone: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
    return (
      <ol className="space-y-5 text-[0.92rem]">
        <li>
          <p className="font-medium">1. Add Chaperone to your agent</p>
          <p className="mt-1 text-ink-2">The key is shown once. Only its hash is stored, so copy it now.</p>
          <div className="mt-3 space-y-3">
            <Snippet label="Claude Code" text={`claude mcp add --transport http chaperone ${endpoint} --header "Authorization: Bearer ${key}"`} />
            <Snippet label="Or a JSON config (.mcp.json)" text={json} />
          </div>
        </li>
        <li>
          <p className="font-medium">2. Ask it to shop</p>
          <div className="mt-3">
            <Snippet label="Try saying" text={EXAMPLE} />
          </div>
        </li>
        <li>
          <p className="font-medium">3. Watch it here</p>
          <p className="mt-1 text-ink-2">
            Its requests show up under Activity, marked &ldquo;your agent&rdquo;, and get the same checks as the buttons on the left. Revoking the mandate stops it.
          </p>
        </li>
      </ol>
    );
  }
  return (
    <div>
      <ul className="mb-5 space-y-2 text-[0.88rem]">
        {TOOLS.map(([name, what]) => (
          <li key={name}>
            <code className="font-mono text-[0.8rem] text-ink">{name}</code> <span className="text-ink-2">{what}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const r = await createAgentKey();
            if (r.ok) setCreated({ key: r.key, endpoint: r.endpoint });
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
