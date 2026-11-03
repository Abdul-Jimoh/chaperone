"use client";

import { useRef, useState } from "react";
import { gsap, MOTION, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";

const TOOLS = [
  {
    name: "request_payment",
    blurb: "Propose a cart. Chaperone decides, places the hold and captures it, or waits for the user.",
    request: `{
  "payee_merchant_id": "…",
  "items": [{
    "title": "Dry dog food, 12 kg",
    "unit_price_cents": 2649,
    "quantity": 1,
    "category": "dog-food"
  }]
}`,
    response: `{
  "shop": "Pet Pantry",
  "total_cents": 2649,
  "decision": "allow",
  "status": "captured",
  "clause_id": "within_limits",
  "already_requested": false
}`,
  },
  {
    name: "check_mandate",
    blurb: "Read the rules, the shops to pay and the budget left. Optionally preview a cart without reserving anything.",
    request: `{
  "cart": { "payee_merchant_id": "…", "items": [ … ] }
}`,
    response: `{
  "shops": [{ "name": "Pet Pantry", "merchant_id": "…" }, …],
  "per_purchase_cap_cents": 8000,
  "ask_user_above_cents": 4000,
  "budgets": [{ "period": "month", "remaining_cents": 12351 }],
  "preview": { "decision": "needs_approval", … }
}`,
  },
  {
    name: "list_spend",
    blurb: "Recent payments under this mandate, with the rule that decided each one.",
    request: `{ "limit": 20 }`,
    response: `{
  "mandate_status": "active",
  "payments": [{
    "shop": "Home Basics",
    "total_cents": 4499,
    "decision": "needs_approval",
    "status": "pending_approval"
  }, …]
}`,
  },
  {
    name: "revoke_mandate",
    blurb: "Stop everything: open holds are voided and every later request is denied.",
    request: `{}`,
    response: `{
  "revoked": true,
  "holds_released": 1,
  "holds_still_open": 0,
  "message": "The mandate is revoked. Every further
    payment request under it will be denied."
}`,
  },
];

const CONFIG = `{
  "mcpServers": {
    "chaperone": {
      "url": "https://www.chaperone.site/api/mcp",
      "headers": { "Authorization": "Bearer chp_ak_…" }
    }
  }
}`;

export function Developers() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const tool = TOOLS[active]!;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-code-line]", { autoAlpha: 0, x: -10, stagger: 0.025, duration: 0.4, ease: "power2.out" });
      });
    },
    { scope: root, dependencies: [active] },
  );

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-dev-in]", {
          y: 40,
          autoAlpha: 0,
          stagger: 0.1,
          duration: 1,
          ease: "hold",
          scrollTrigger: { trigger: root.current, start: "top 70%", once: true },
        });
      });
    },
    { scope: root },
  );

  const lines = (text: string) =>
    text.split("\n").map((l, i) => (
      <span key={i} data-code-line className="block whitespace-pre">
        {l || " "}
      </span>
    ));

  return (
    <section ref={root} id="developers" className="grain relative overflow-hidden bg-night text-paper">
      <div className="pointer-events-none absolute -right-40 top-10 h-[38rem] w-[38rem] rounded-full bg-accent/25 blur-[140px]" />
      <div className="relative mx-auto max-w-[1680px] px-5 py-24 sm:px-8 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-12 [&>*]:min-w-0">
          <div className="lg:col-span-5">
            <p className="label text-paper/60">For developers</p>
            <Reveal as="h2" by="lines" className="display mt-5 text-[clamp(2.1rem,4.2vw,4.2rem)]">
              A payment rail with the limits built in.
            </Reveal>
            <p data-dev-in className="mt-8 max-w-lg text-[1.05rem] leading-relaxed text-paper/70">
              Chaperone is an MCP server. Give any MCP agent an agent key: the key fixes the mandate, and no tool takes a mandate id, so an agent
              can’t pick a looser one. Retried calls are safe, because the PayPal request id comes from the cart and the mandate.
            </p>
            <pre data-dev-in className="mt-8 overflow-x-auto rounded-xl border border-night-line bg-night-2 p-4 font-mono text-[0.78rem] leading-relaxed text-paper/80" data-lenis-prevent>
              {CONFIG}
            </pre>
          </div>

          <div data-dev-in className="lg:col-span-7">
            <div role="tablist" aria-label="MCP tools" className="flex flex-wrap gap-2">
              {TOOLS.map((t, i) => (
                <button
                  key={t.name}
                  role="tab"
                  aria-selected={i === active}
                  aria-controls="tool-panel"
                  onClick={() => setActive(i)}
                  className={`rounded-full border px-4 py-2 font-mono text-[0.8rem] transition-colors duration-300 ${
                    i === active ? "border-paper bg-paper text-ink" : "border-night-line text-paper/70 hover:border-paper/50 hover:text-paper"
                  }`}
                >
                  <span className="mr-2 opacity-50">0{i + 1}</span>
                  {t.name}
                </button>
              ))}
            </div>
            <div id="tool-panel" role="tabpanel" className="mt-6 overflow-hidden rounded-[1.4rem] border border-night-line bg-night-2">
              <p className="border-b border-night-line px-5 py-4 text-[0.98rem] text-paper/80">{tool.blurb}</p>
              <div className="grid min-h-[17rem] font-mono text-[0.78rem] leading-relaxed md:grid-cols-2" data-lenis-prevent>
                <div className="overflow-x-auto border-b border-night-line p-5 md:border-b-0 md:border-r">
                  <p className="label mb-3 text-paper/40">→ arguments</p>
                  <code className="text-paper/85">{lines(tool.request)}</code>
                </div>
                <div className="overflow-x-auto p-5">
                  <p className="label mb-3 text-paper/40">← result</p>
                  <code className="text-mint">{lines(tool.response)}</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
