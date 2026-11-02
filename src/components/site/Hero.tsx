"use client";

import { useRef } from "react";
import { gsap, MOTION, useGSAP } from "@/lib/motion/gsap";
import { scrollToTarget } from "@/lib/motion/lenis";
import { Contours } from "./Contours";
import { HoldTicket } from "./HoldTicket";
import { Reveal } from "./Reveal";

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-hero-fade]", { y: 24, autoAlpha: 0, duration: 1, ease: "hold", stagger: 0.08, delay: 0.9 });
        gsap.from("[data-hero-ticket]", { y: 60, autoAlpha: 0, rotate: 2, duration: 1.3, ease: "hold", delay: 0.6 });
        gsap.from("[data-cross]", { scale: 0, rotate: -90, duration: 1, ease: "back.out(2)", delay: 1.2 });
        gsap.from("[data-rule-v]", { scaleY: 0, transformOrigin: "top", duration: 1.6, ease: "hold", delay: 0.2 });
        gsap.from("[data-rule-h]", { scaleX: 0, transformOrigin: "left", duration: 1.6, ease: "hold", delay: 0.35 });
        gsap.to("[data-hero-ticket]", {
          yPercent: -12,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
        });
        gsap.to("[data-hero-copy]", {
          yPercent: 14,
          autoAlpha: 0.2,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "30% top", end: "bottom top", scrub: true },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="top" className="relative isolate min-h-[100svh] overflow-hidden pt-24">
      <Contours className="absolute inset-0 -z-10 h-full w-full" />
      <div className="pointer-events-none absolute inset-y-0 left-[66.6%] -z-10 hidden w-px bg-line-strong lg:block" data-rule-v />
      <div className="pointer-events-none absolute inset-x-0 top-[62%] -z-10 hidden h-px bg-line lg:block" data-rule-h />
      <span data-cross aria-hidden className="pointer-events-none absolute left-[66.6%] top-[62%] -z-10 hidden -translate-x-1/2 -translate-y-1/2 text-[2.2rem] font-light leading-none text-accent lg:block">
        +
      </span>

      <div className="mx-auto grid min-h-[calc(100svh-6rem)] max-w-[1680px] grid-cols-1 gap-10 px-5 pb-10 sm:px-8 lg:grid-cols-12 lg:gap-0">
        <div data-hero-copy className="flex flex-col justify-end lg:col-span-8 lg:pb-8 lg:pr-10">
          <p data-hero-fade className="label mb-6 text-ink-2">
            [ PayPal sandbox · payments for AI agents ]
          </p>
          <Reveal as="h1" by="chars" immediate delay={0.35} className="display text-[clamp(3rem,7.6vw,9rem)]">
            Your agent shops.
            <br />
            Chaperone holds
            <br />
            the money<span className="text-accent">.</span>
          </Reveal>
          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,34rem)_auto] xl:items-end xl:justify-between">
            <p data-hero-fade className="max-w-[34rem] text-[1.08rem] leading-relaxed text-ink-2 sm:text-[1.15rem]">
              Write your rules in plain English. Every purchase your agent makes becomes a PayPal{" "}
              <em className="not-italic text-ink">authorization hold</em>, checked by deterministic code before it is captured or voided.
            </p>
            <div data-hero-fade className="flex flex-wrap gap-3">
              <a
                href="#flow"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToTarget("#flow", -24);
                }}
                className="group inline-flex items-center gap-3 rounded-full bg-ink py-2 pl-5 pr-2 text-paper"
              >
                How a payment works
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent transition-transform duration-500 ease-[var(--ease-hold)] group-hover:rotate-90">
                  →
                </span>
              </a>
              <a
                href="#developers"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToTarget("#developers", -24);
                }}
                className="inline-flex items-center rounded-full border border-line-strong px-5 py-2 transition-colors hover:bg-ink hover:text-paper"
              >
                Connect an agent (MCP)
              </a>
            </div>
          </div>
        </div>

        <div className="flex items-center lg:col-span-4 lg:pl-10">
          <div data-hero-ticket className="relative w-full max-w-md lg:max-w-none">
            <span className="pointer-events-none absolute -left-2 -top-9 rotate-[-4deg] font-hand text-[1.05rem] text-ink-2 sm:-left-6">
              three carts, one mandate ↘
            </span>
            <HoldTicket />
          </div>
        </div>
      </div>
    </section>
  );
}
