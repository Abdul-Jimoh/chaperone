"use client";

import { useRef } from "react";
import { gsap, MOTION, useGSAP } from "@/lib/motion/gsap";
import { Reveal } from "./Reveal";

const POINTS = [
  {
    label: "Today",
    title: "An agent with your card can spend anything.",
    body: "To let an agent buy for you, you give it a card or a login. Nothing stops it from overspending, and one misleading product page can steer it to the wrong shop.",
  },
  {
    label: "With Chaperone",
    title: "You set the limits in plain English.",
    body: "What to buy, which shops, how much per run and per month, and when to ask you first. The agent can only pay through PayPal, inside those limits.",
  },
  {
    label: "Every purchase",
    title: "Held, checked, then paid or cancelled.",
    body: "Each payment is a PayPal hold. Plain code, not AI, checks it against your rules. You see every decision and the rule behind it, and can stop everything with one tap.",
  },
];

export function ProblemSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-point]", {
          y: 32,
          autoAlpha: 0,
          stagger: 0.12,
          duration: 0.9,
          ease: "hold",
          scrollTrigger: { trigger: "[data-points]", start: "top 80%", once: true },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="border-t border-line bg-paper-2/60">
      <div className="mx-auto max-w-[1680px] px-5 py-20 sm:px-8 lg:py-28">
        <p className="label text-ink-2">The problem</p>
        <Reveal as="h2" by="lines" className="display mt-5 max-w-4xl text-[clamp(2.1rem,4.6vw,4.4rem)]">
          Agents can already shop. Trusting one with your money is the hard part.
        </Reveal>
        <ol data-points className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {POINTS.map((p, i) => (
            <li key={p.label} data-point className="border-t border-line-strong pt-6">
              <p className="label flex items-center gap-3 text-accent-ink">
                <span className="text-ink-3">0{i + 1}</span> {p.label}
              </p>
              <h3 className="mt-4 text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.03em]">{p.title}</h3>
              <p className="mt-3 text-[1.02rem] leading-relaxed text-ink-2">{p.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
