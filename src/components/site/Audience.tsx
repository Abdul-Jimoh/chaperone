"use client";

import { useRef } from "react";
import { gsap, MOTION, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";

const JOBS = [
  { n: "01", title: "Compile your mandate", body: "Turns your sentence into a typed policy, and says what it couldn’t enforce." },
  { n: "02", title: "Run the shopping agent", body: "Searches the catalogue and proposes a cart: listing ids and quantities only." },
  { n: "03", title: "Classify products", body: "Maps each listing to one of your categories, or answers “unsure” so you get asked." },
];

const BUILT_WITH = [
  "PayPal Orders v2",
  "PayPal Payments v2",
  "PayPal Vault v3",
  "PayPal Webhooks",
  "Claude Haiku 5.5",
  "Model Context Protocol",
  "Channel3 product search",
  "AG Grid",
  "Postgres on Neon",
  "Next.js on Vercel",
];

export function Audience() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-card]", {
          y: 80,
          autoAlpha: 0,
          rotate: (i) => (i ? 2 : -2),
          stagger: 0.15,
          duration: 1.2,
          ease: "hold",
          scrollTrigger: { trigger: "[data-cards]", start: "top 80%", once: true },
        });
        gsap.from("[data-job]", {
          y: 30,
          autoAlpha: 0,
          stagger: 0.12,
          duration: 1,
          ease: "hold",
          scrollTrigger: { trigger: "[data-jobs]", start: "top 80%", once: true },
        });
        gsap.from("[data-tag]", {
          scale: 0.6,
          autoAlpha: 0,
          stagger: { each: 0.04, from: "random" },
          duration: 0.6,
          ease: "back.out(2)",
          scrollTrigger: { trigger: "[data-tags]", start: "top 90%", once: true },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="border-t border-line">
      <div className="mx-auto max-w-[1680px] px-5 py-24 sm:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-12">
          <p className="label text-ink-2 lg:col-span-4">Who it’s for</p>
          <Reveal as="h2" by="lines" className="display text-[clamp(2.1rem,4.6vw,4.4rem)] lg:col-span-8">
            Two kinds of people hand an agent a wallet.
          </Reveal>
        </div>

        <div data-cards className="mt-14 grid gap-5 md:grid-cols-2 lg:mt-20">
          <article data-card className="flex min-h-[22rem] flex-col justify-between rounded-[1.6rem] bg-mint p-7 text-ink sm:p-9">
            <span className="label">For you</span>
            <div>
              <h3 className="text-[clamp(1.9rem,3.2vw,3rem)] font-semibold leading-[1] tracking-[-0.045em]">
                You want an agent to handle the recurring shopping.
              </h3>
              <p className="mt-4 max-w-md text-[1.02rem] leading-relaxed text-ink/75">
                Link PayPal once, write the rules once. Small, expected purchases go through on their own; anything over your line waits for one tap on
                your phone; one more tap revokes it all.
              </p>
            </div>
          </article>
          <article data-card className="flex min-h-[22rem] flex-col justify-between rounded-[1.6rem] bg-ink p-7 text-paper sm:p-9">
            <span className="label text-paper/60">For builders</span>
            <div>
              <h3 className="text-[clamp(1.9rem,3.2vw,3rem)] font-semibold leading-[1] tracking-[-0.045em]">
                You’re building a shopping agent and need a payment rail with limits.
              </h3>
              <p className="mt-4 max-w-md text-[1.02rem] leading-relaxed text-paper/70">
                Four MCP tools, one agent key per mandate. Your agent proposes; Chaperone checks, holds, captures or voids, and keeps the ledger.
              </p>
            </div>
          </article>
        </div>

        <div data-jobs className="mt-24 grid gap-10 border-t border-line-strong pt-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="label text-ink-2">Where the AI is</p>
            <p className="mt-4 text-[clamp(1.6rem,2.6vw,2.4rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
              Claude has three jobs. Deciding a payment isn’t one of them.
            </p>
          </div>
          <ol className="grid gap-8 sm:grid-cols-3 lg:col-span-8">
            {JOBS.map((j) => (
              <li key={j.n} data-job>
                <span className="label text-accent-ink">({j.n})</span>
                <h3 className="mt-3 text-[1.35rem] font-semibold tracking-[-0.03em]">{j.title}</h3>
                <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-2">{j.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-20">
          <p className="label text-ink-2">Built with</p>
          <ul data-tags className="mt-5 flex flex-wrap gap-2">
            {BUILT_WITH.map((b) => (
              <li key={b} data-tag className="rounded-full border border-line-strong px-4 py-2 text-[0.92rem]">
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
