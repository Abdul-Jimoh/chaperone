"use client";

import { useState, useTransition } from "react";
import { createAgentKey, disconnect } from "@/app/app/actions";

export const EXAMPLE_PROMPT = "Check my Chaperone rules, then find a 5 kg bag of dry dog food and buy it from Pet Pantry.";

export type ConnectedAgent = { id: string; label: string; via: string; lastUsedAt: string | null };

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

function KeyFallback({ disabled }: { disabled: boolean }) {
  const [created, setCreated] = useState<{ key: string; endpoint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (created) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-ink-2">Shown once; only its hash is stored. Anyone with it can pay under your rules, so keep it out of chats.</p>
        <Snippet label="Claude Code, with a key" text={`claude mcp add --transport http chaperone ${created.endpoint} --header "Authorization: Bearer ${created.key}"`} />
      </div>
    );
  }
  return (
    <div className="mt-3">
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
        className="inline-flex h-10 items-center rounded-full border border-line-strong px-4 font-medium hover:border-ink disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create a key"}
      </button>
      {error && <p className="mt-2 text-accent-ink">{error}</p>}
    </div>
  );
}

function Connected({ agents }: { agents: ConnectedAgent[] }) {
  const [pending, start] = useTransition();
  if (!agents.length) return <p className="mt-1 text-ink-2">None yet. Once you press Allow, your agent shows up here.</p>;
  return (
    <ul className="mt-2 divide-y divide-line border-y border-line">
      {agents.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-medium">{a.label}</p>
            <p className="text-[0.85rem] text-ink-2">
              {a.via === "oauth" ? "Signed in" : "Key"} · {a.lastUsedAt ? `last used ${new Date(a.lastUsedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "not used yet"}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => disconnect(a.id))}
            className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-[0.88rem] hover:border-accent hover:text-accent-ink disabled:opacity-50"
          >
            Disconnect
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ConnectAgent({ endpoint, agents, disabled }: { endpoint: string; agents: ConnectedAgent[]; disabled: boolean }) {
  const json = JSON.stringify({ mcpServers: { chaperone: { type: "http", url: endpoint } } }, null, 2);
  return (
    <ol className="space-y-6 text-[0.92rem]">
      <li>
        <p className="font-medium">1. Add Chaperone to your agent</p>
        <div className="mt-3 space-y-3">
          <Snippet label="Claude Code" text={`claude mcp add --transport http chaperone ${endpoint}`} />
          <Snippet label="Other MCP clients (.mcp.json)" text={json} />
        </div>
      </li>
      <li>
        <p className="font-medium">2. Sign in and allow it</p>
        <p className="mt-1 leading-relaxed text-ink-2">
          In Claude Code, run <code className="font-mono text-ink">/mcp</code>, pick <span className="text-ink">chaperone</span> and choose Authenticate. Chaperone
          opens in your browser: check the rules and press Allow. Use this browser, so it knows you. Nothing to copy, no key in your chat.
        </p>
      </li>
      <li>
        <p className="font-medium">3. Ask it to shop</p>
        <div className="mt-3">
          <Snippet label="Try saying" text={EXAMPLE_PROMPT} />
        </div>
      </li>
      <li>
        <p className="font-medium">4. Watch it here</p>
        <p className="mt-1 text-ink-2">Its payments appear under Activity marked &ldquo;your agent&rdquo;, with the same checks as the agent above.</p>
        <p className="label mt-4 text-ink-2">Connected agents</p>
        <Connected agents={agents} />
      </li>
      <li>
        <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer font-medium">No sign-in support in your client? Use a key instead</summary>
          <KeyFallback disabled={disabled} />
        </details>
      </li>
    </ol>
  );
}
