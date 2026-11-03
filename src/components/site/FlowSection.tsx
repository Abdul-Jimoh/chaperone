"use client";

import { useRef } from "react";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";
import { SHELL, STAGE_COLOR, type Stage } from "./shapes";

const STEPS: { stage: Stage; title: string; tag: string; body: string }[] = [
  {
    stage: "hold",
    title: "Hold",
    tag: "PayPal authorization",
    body: "The agent asks to pay. Your linked PayPal wallet puts a hold on the exact amount, payable only to that shop. Nothing is charged yet, and the amount is set aside from your budget.",
  },
  {
    stage: "check",
    title: "Check",
    tag: "plain code, not AI",
    body: "Chaperone compares the purchase with your rules: the shop, what it is, the price, this run and this month. It answers allow, ask you, or deny, and names the rule that decided.",
  },
  {
    stage: "capture",
    title: "Capture",
    tag: "the shop gets paid",
    body: "If every rule passes, the hold is captured. If it’s over your ask-me line, you get a link on your phone, and tapping approve captures it.",
  },
  {
    stage: "void",
    title: "Void",
    tag: "the money is released",
    body: "If you reject it, don’t answer within 24 hours, or revoke the mandate, the hold is cancelled and your budget comes back. No charge ever happened.",
  },
];

function Glyph({ stage, className = "" }: { stage: Stage; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={SHELL[stage]} fill={stage === "check" ? "currentColor" : STAGE_COLOR[stage]} />
      {stage === "check" && (
        <>
          <circle cx="31" cy="64" r="7" className="fill-paper group-data-[active]:fill-ink" />
          <circle cx="69" cy="64" r="7" className="fill-paper group-data-[active]:fill-ink" />
        </>
      )}
    </svg>
  );
}

export function FlowSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const shell = root.current!.querySelector("[data-shell]");
      const glints = root.current!.querySelectorAll("[data-glint]");
      const label = root.current!.querySelector<HTMLElement>("[data-stage-label]");
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
      let current: Stage = "hold";

      const activate = (step: HTMLElement) => {
        steps.forEach((s) => s.toggleAttribute("data-active", s === step));
        const stage = step.dataset.step as Stage;
        if (stage === current) return;
        current = stage;
        gsap.to(shell, { morphSVG: { shape: SHELL[stage], shapeIndex: "auto" }, fill: STAGE_COLOR[stage], duration: 0.7, ease: "hold", overwrite: true });
        gsap.to(glints, { autoAlpha: stage === "check" ? 1 : 0, scale: stage === "check" ? 1 : 0, transformOrigin: "50% 50%", duration: 0.4, overwrite: true });
        if (label) label.textContent = step.dataset.title ?? stage;
      };

      // One trigger per row drives both the highlighted row and the glyph, so they can't disagree.
      steps.forEach((step, i) => {
        ScrollTrigger.create({
          trigger: step,
          start: "top 60%",
          end: "bottom 60%",
          onToggle: (self) => self.isActive && activate(step),
          onLeaveBack: () => i === 0 && steps.forEach((s) => s.removeAttribute("data-active")),
        });
      });

      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        steps.forEach((step) =>
          gsap.from(step.querySelectorAll("[data-step-in]"), {
            y: 28,
            autoAlpha: 0,
            duration: 0.9,
            stagger: 0.06,
            ease: "hold",
            scrollTrigger: { trigger: step, start: "top 85%", once: true },
          }),
        );
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="flow" className="relative border-t border-line">
      <div className="mx-auto max-w-[1680px] px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-4xl">
          <p className="label text-ink-2">How a purchase works</p>
          <Reveal as="h2" by="lines" className="display mt-5 text-[clamp(2.1rem,4.6vw,4.4rem)]">
            Every payment is a hold first. Nothing is charged until your rules say yes.
          </Reveal>
        </div>

        <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-12">
          <div className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-32 flex flex-col items-start">
              <svg viewBox="0 0 100 100" className="h-[clamp(12rem,18vw,17rem)] w-auto overflow-visible" aria-hidden="true">
                <path data-shell d={SHELL.hold} fill={STAGE_COLOR.hold} />
                <circle data-glint cx="31" cy="64" r="7" fill="var(--color-paper)" opacity="0" />
                <circle data-glint cx="69" cy="64" r="7" fill="var(--color-paper)" opacity="0" />
              </svg>
              <p className="label mt-8 text-ink-2">
                Step: <span data-stage-label className="text-ink">Hold</span>
              </p>
            </div>
          </div>

          <ol className="space-y-3 lg:col-span-8">
            {STEPS.map((s, i) => (
              <li
                key={s.stage}
                data-step={s.stage}
                data-title={s.title}
                className="group rounded-[1.4rem] border border-line-strong p-6 transition-colors duration-500 data-[active]:border-ink data-[active]:bg-ink data-[active]:text-paper sm:p-8"
              >
                <div className="flex items-center gap-4 sm:gap-6">
                  <Glyph stage={s.stage} className="h-10 w-10 shrink-0 lg:hidden" />
                  <span data-step-in className="label hidden text-ink-3 group-data-[active]:text-paper/55 lg:inline">
                    0{i + 1}
                  </span>
                  <h3 data-step-in className="text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-none tracking-[-0.045em]">
                    {s.title}
                  </h3>
                  <span data-step-in className="label ml-auto hidden text-accent-ink group-data-[active]:text-accent sm:inline">
                    {s.tag}
                  </span>
                </div>
                <p data-step-in className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-ink-2 group-data-[active]:text-paper/75 lg:pl-11">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
