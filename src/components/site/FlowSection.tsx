"use client";

import { useRef } from "react";
import { DESKTOP, gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";
import { SHELL, type Stage } from "./shapes";

const STEPS: { stage: Stage; title: string; left: string; right: string; body: string }[] = [
  {
    stage: "hold",
    title: "Hold",
    left: "Orders v2 · AUTHORIZE",
    right: "budget reserved",
    body: "Your vaulted PayPal wallet authorizes the exact cart, paid to the shop’s merchant ID. The budget is reserved in the same database transaction, under a row lock, so parallel requests can’t overspend.",
  },
  {
    stage: "check",
    title: "Check",
    left: "pure function",
    right: "clause + mandate hash",
    body: "A deterministic evaluator returns allow, needs approval or deny and names the clause that decided it. Every ledger row keeps the hash of the mandate it was checked against.",
  },
  {
    stage: "capture",
    title: "Capture",
    left: "Payments v2",
    right: "or your one tap",
    body: "Allowed purchases are captured straight away. Over your line, you get a signed, single-use link on your phone, and approving it captures the hold.",
  },
  {
    stage: "void",
    title: "Void",
    left: "reject · timeout · revoke",
    right: "budget released",
    body: "Reject it, leave it for 24 hours, or revoke the mandate: the hold is voided with the shop’s own credentials and the budget comes back. Webhooks confirm it in the ledger.",
  },
];

const COLORS: Record<Stage, string> = {
  hold: "var(--color-ink)",
  check: "var(--color-ink)",
  capture: "var(--color-go)",
  void: "var(--color-ink-3)",
};

export function FlowSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const shell = root.current!.querySelector("[data-shell]");
      const coin = root.current!.querySelector("[data-coin-big]");
      const label = root.current!.querySelector<HTMLElement>("[data-stage-label]");
      const mm = gsap.matchMedia();

      const morphTo = (stage: Stage) => {
        gsap.to(shell, { morphSVG: { shape: SHELL[stage], shapeIndex: "auto" }, fill: COLORS[stage], duration: 0.9, ease: "hold", overwrite: true });
        const coinState =
          stage === "capture" ? { x: 34, scale: 0.5, autoAlpha: 0 } : stage === "void" ? { x: -34, scale: 0.6, autoAlpha: 0 } : { x: 0, scale: 1, autoAlpha: 1 };
        gsap.to(coin, { ...coinState, duration: 0.8, ease: "hold", overwrite: true });
        if (label) gsap.to(label, { duration: 0.6, scrambleText: { text: stage, chars: "lowerCase", speed: 0.7 } });
      };

      mm.add(`${DESKTOP} and ${MOTION}`, () => {
        gsap.utils.toArray<HTMLElement>("[data-step]").forEach((step) => {
          ScrollTrigger.create({
            trigger: step,
            start: "top 55%",
            end: "bottom 55%",
            onToggle: (self) => self.isActive && morphTo(step.dataset.step as Stage),
          });
        });
      });

      mm.add(MOTION, () => {
        gsap.utils.toArray<HTMLElement>("[data-step]").forEach((step) => {
          gsap.from(step.querySelectorAll("[data-step-in]"), {
            y: 40,
            autoAlpha: 0,
            duration: 1,
            stagger: 0.08,
            ease: "hold",
            scrollTrigger: { trigger: step, start: "top 85%", once: true },
          });
          gsap.from(step.querySelector("[data-step-rule]"), {
            scaleX: 0,
            transformOrigin: "left",
            duration: 1.4,
            ease: "hold",
            scrollTrigger: { trigger: step, start: "top 90%", once: true },
          });
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="flow" className="relative border-t border-line bg-paper-2/60">
      <div className="mx-auto max-w-[1680px] px-5 py-24 sm:px-8 lg:py-32">
        <div className="mb-14 grid gap-6 lg:mb-20 lg:grid-cols-12">
          <p className="label text-ink-2 lg:col-span-4">[ 02 — Every payment is a hold ]</p>
          <Reveal as="h2" by="lines" className="display text-[clamp(2.4rem,6vw,6.2rem)] lg:col-span-8">
            Nothing is captured until code says yes.
          </Reveal>
        </div>

        <div className="grid gap-10 lg:grid-cols-12">
          <div className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-28">
              <svg viewBox="0 0 100 100" className="h-[clamp(14rem,22vw,22rem)] w-auto overflow-visible" aria-hidden="true">
                <path data-shell d={SHELL.hold} fill="var(--color-ink)" />
                <circle data-coin-big cx="50" cy="50" r="11" fill="var(--color-accent)" />
              </svg>
              <p className="label mt-6 text-ink-2">
                state: <span data-stage-label className="text-ink">hold</span>
              </p>
            </div>
          </div>

          <ol className="lg:col-span-8">
            {STEPS.map((s, i) => (
              <li key={s.stage} data-step={s.stage} className="group relative py-2">
                <div data-step-rule className="absolute inset-x-0 top-0 h-px bg-line-strong" />
                <div className="relative rounded-[1.6rem] px-2 py-8 transition-colors duration-500 ease-[var(--ease-hold)] sm:px-6 lg:hover:bg-ink lg:hover:text-paper">
                  <div className="flex items-baseline gap-5 sm:gap-8">
                    <span data-step-in className="label shrink-0 text-ink-3 group-hover:text-paper/60">
                      (0{i + 1})
                    </span>
                    <h3 data-step-in className="text-[clamp(2.6rem,7vw,6.5rem)] font-medium leading-[0.95] tracking-[-0.055em]">
                      {s.title}
                    </h3>
                    <span className="label ml-auto hidden translate-x-4 self-center text-paper opacity-0 transition-all duration-500 group-hover:translate-x-0 group-hover:opacity-100 xl:inline">
                      {s.left}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 sm:ml-[4.5rem] sm:grid-cols-[minmax(0,36rem)_auto] sm:justify-between">
                    <p data-step-in className="text-[1.02rem] leading-relaxed text-ink-2 group-hover:text-paper/75">
                      {s.body}
                    </p>
                    <span data-step-in className="label self-end text-accent-ink group-hover:text-accent">
                      {s.right}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
