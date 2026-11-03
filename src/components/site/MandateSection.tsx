"use client";

import { useRef } from "react";
import { DESKTOP, gsap, MOTION, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";

const PHRASES: { text: string; clause: number | null }[] = [
  { text: "Buy dog food and household basics", clause: 0 },
  { text: "like paper towels and dish soap", clause: null },
  { text: "every two weeks.", clause: 1 },
  { text: "Max $80 per run", clause: 2 },
  { text: "and $150 a month.", clause: 3 },
  { text: "Only use these 3 shops.", clause: 4 },
  { text: "Ask me before anything over $40.", clause: 5 },
];

const CLAUSES = [
  { key: "categories", value: "dog-food · paper-towels · dish-soap" },
  { key: "schedule", value: "every 2 weeks" },
  { key: "cap + budget.run", value: "$80.00" },
  { key: "budget.month", value: "$150.00" },
  { key: "payees", value: "Corner Market · Pet Pantry · Home Basics" },
  { key: "approval", value: "ask me above $40.00" },
];

export function MandateSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ desktop: `${DESKTOP} and ${MOTION}`, mobile: `(max-width: 1023px) and ${MOTION}` }, (ctx) => {
        const words = gsap.utils.toArray<HTMLElement>("[data-word]");
        const rows = gsap.utils.toArray<HTMLElement>("[data-clause]");
        gsap.set(words, { opacity: 0.14 });
        gsap.set(rows, { autoAlpha: 0, x: 24 });
        gsap.set("[data-signed]", { autoAlpha: 0, y: 16 });

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: ctx.conditions!.desktop
            ? { trigger: "[data-pin]", start: "top top", end: "+=190%", pin: true, scrub: 0.8 }
            : { trigger: "[data-sentence]", start: "top 75%", end: "bottom 35%", scrub: 0.8 },
        });
        PHRASES.forEach((p, i) => {
          tl.to(words.filter((w) => w.dataset.phrase === String(i)), { opacity: 1, stagger: 0.08, duration: 0.3 });
          if (p.clause !== null && ctx.conditions!.desktop) {
            tl.to(rows[p.clause]!, { autoAlpha: 1, x: 0, duration: 0.45, ease: "power2.out" }, "<0.1");
          }
        });
        tl.to("[data-signed]", { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" });
        tl.from("[data-stamp]", { scale: 2.2, rotate: -25, autoAlpha: 0, duration: 0.5, ease: "back.out(2)" });

        if (ctx.conditions!.mobile) {
          rows.forEach((row) =>
            gsap.to(row, { autoAlpha: 1, x: 0, duration: 0.7, ease: "hold", scrollTrigger: { trigger: row, start: "top 90%", once: true } }),
          );
          gsap.to("[data-signed]", { autoAlpha: 1, y: 0, duration: 0.7, scrollTrigger: { trigger: "[data-signed]", start: "top 92%", once: true } });
        }
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="mandate" className="relative border-t border-line">
      <div data-pin className="mx-auto grid min-h-[100svh] max-w-[1680px] grid-cols-1 gap-12 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-10 lg:py-16">
        <div className="lg:col-span-7">
          <p className="label mb-6 text-ink-2">Your rules, in your words</p>
          <p data-sentence className="text-[clamp(1.8rem,3.6vw,3.8rem)] font-medium leading-[1.1] tracking-[-0.035em]">
            <span className="text-ink-3">“</span>
            {PHRASES.map((p, i) =>
              p.text.split(" ").map((w, j) => (
                <span key={`${i}-${j}`} data-word data-phrase={i} className={p.clause === null ? "text-ink-2" : ""}>
                  {w}{" "}
                </span>
              )),
            )}
            <span className="text-ink-3">”</span>
          </p>
          <p className="mt-8 max-w-xl text-[1.02rem] leading-relaxed text-ink-2">
            Claude turns your sentence into exact rules and reads them back to you. Nothing takes effect until you confirm. Then the rules
            are signed and stored, and every payment is checked against that signed copy.
          </p>
        </div>

        <div className="relative lg:col-span-5">
          <span className="pointer-events-none absolute -top-10 right-2 rotate-[3deg] font-hand text-[1.05rem] text-ink-2">
            Claude compiles it. You sign it. ↓
          </span>
          <div className="grid-paper overflow-hidden rounded-[1.4rem] border border-line-strong bg-paper-2">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <span className="label text-ink-2">policy.json · read-back</span>
              <span className="label text-ink-3">draft</span>
            </div>
            <ul>
              {CLAUSES.map((c) => (
                <li key={c.key} className="grid grid-cols-[7rem_1fr] items-baseline gap-3 sm:grid-cols-[8.5rem_1fr] sm:gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
                  <span className="font-mono text-[0.78rem] text-accent-ink">{c.key}</span>
                  <span data-clause className="text-[1rem] font-medium tracking-[-0.02em]">
                    {c.value}
                  </span>
                </li>
              ))}
            </ul>
            <div data-signed className="relative border-t border-line-strong bg-paper px-5 py-4">
              <p className="text-[0.92rem] text-ink-2">
                Claude flagged one thing it can&apos;t enforce: <span className="text-ink">“household basics” is broader than your two examples</span>, so anything unsure is sent to you.
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="label text-ink-2">you confirm → ES256 JWS · sha256 stored</span>
                <span data-stamp className="rotate-[-6deg] rounded-md border-2 border-go px-2 py-0.5 font-mono text-[0.75rem] font-bold uppercase tracking-wider text-go">
                  signed
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1680px] px-5 pb-6 sm:px-8">
        <Reveal as="p" by="words" className="label text-ink-3">
          The LLM never writes a policy you haven&apos;t confirmed.
        </Reveal>
      </div>
    </section>
  );
}
