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
        gsap.from("[data-hero-fade]", { y: 20, autoAlpha: 0, duration: 0.9, ease: "hold", stagger: 0.08, delay: 0.8 });
        gsap.from("[data-hero-ticket]", { y: 40, autoAlpha: 0, duration: 1.1, ease: "hold", delay: 0.6 });
      });
    },
    { scope: root },
  );

  const jump = (target: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    scrollToTarget(target, -16);
  };

  return (
    <section ref={root} id="top" className="relative isolate overflow-hidden pt-24 lg:min-h-[100svh]">
      <Contours className="absolute inset-0 -z-10 hidden h-full w-full lg:block" />

      <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-12 px-5 pb-16 pt-8 sm:px-8 lg:min-h-[calc(100svh-6rem)] lg:grid-cols-12 lg:items-end lg:gap-10 lg:pb-14">
        <div className="lg:col-span-7 xl:col-span-8">
          <p data-hero-fade className="label mb-6 text-ink-2">
            PayPal sandbox · payments for AI agents
          </p>
          <Reveal as="h1" by="chars" immediate delay={0.3} className="display text-[clamp(2.8rem,7vw,8.25rem)]">
            Your agent shops.
            <br />
            Chaperone holds
            <br />
            the money<span className="text-accent">.</span>
          </Reveal>
          <p data-hero-fade className="mt-8 max-w-[36rem] text-[1.1rem] leading-relaxed text-ink-2 sm:text-[1.2rem]">
            Letting an AI agent shop for you usually means handing it your card. Chaperone gives it a PayPal wallet with your rules built in:
            every purchase is <span className="text-ink">held first, checked by plain code, then paid or cancelled.</span>
          </p>
          <div data-hero-fade className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#flow"
              onClick={jump("#flow")}
              className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-ink px-6 font-medium text-paper transition-colors hover:bg-accent"
            >
              See how a purchase is checked <span aria-hidden>↓</span>
            </a>
            <a
              href="#developers"
              onClick={jump("#developers")}
              className="inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 font-medium transition-colors hover:border-ink"
            >
              For developers (MCP)
            </a>
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-4">
          <div data-hero-ticket className="mx-auto w-full max-w-md lg:max-w-none">
            <p className="label mb-3 text-ink-2">One mandate, three carts</p>
            <HoldTicket />
          </div>
        </div>
      </div>
    </section>
  );
}
