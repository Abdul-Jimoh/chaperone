"use client";

import { useRef } from "react";
import { gsap, MOTION, useGSAP } from "@/lib/motion/gsap";

const STATS = [
  { value: 0, suffix: "", label: "payment decisions made by Claude", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M5.6 5.6l12.8 12.8" },
  { value: 24, suffix: "h", label: "approval timeout, inside PayPal’s 3-day honour period", icon: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" },
  { value: 1, suffix: " tap", label: "to revoke: open holds voided, the next request denied", icon: "M6 6l12 12M18 6L6 18" },
  { value: 4, suffix: "", label: "MCP tools any agent can call, under one mandate", icon: "M4 7h16M4 12h16M4 17h10" },
  { value: 118, suffix: "", label: "automated tests, run against a real Postgres", icon: "M5 12l4 4L19 6" },
  { value: 100, suffix: "%", label: "of ledger rows store the hash of the mandate they were checked against", icon: "M8 4L6 20M18 4l-2 16M4 9h17M3 15h17" },
];

export function Stats() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.utils.toArray<HTMLElement>("[data-stat]").forEach((cell, i) => {
          const num = cell.querySelector<HTMLElement>("[data-num]")!;
          const target = Number(num.dataset.num);
          const counter = { v: 0 };
          const tl = gsap.timeline({ scrollTrigger: { trigger: cell, start: "top 85%", once: true }, delay: (i % 3) * 0.08 });
          tl.from(cell.querySelector("[data-stat-rule]"), { scaleX: 0, transformOrigin: "left", duration: 1.2, ease: "hold" })
            .from(cell.querySelector("path"), { drawSVG: 0, duration: 1, ease: "power2.inOut" }, 0.1)
            .to(counter, { v: target, duration: 1.4, ease: "power3.out", onUpdate: () => void (num.textContent = String(Math.round(counter.v))) }, 0.1)
            .from(cell.querySelector("[data-stat-label]"), { y: 14, autoAlpha: 0, duration: 0.8, ease: "hold" }, 0.3);
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="border-t border-line">
      <div className="mx-auto grid max-w-[1680px] gap-x-8 px-5 py-20 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:py-28">
        {STATS.map((s) => (
          <div key={s.label} data-stat className="relative grid grid-cols-[2.5rem_1fr] gap-5 pb-14 pt-6">
            <div data-stat-rule className="absolute inset-x-0 top-0 h-px bg-line-strong" />
            <svg viewBox="0 0 24 24" className="mt-2 h-9 w-9 text-ink" aria-hidden="true">
              <path d={s.icon} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="text-[clamp(3.2rem,6vw,5.4rem)] font-semibold leading-none tracking-[-0.06em] tabular-nums">
                <span data-num={s.value}>{s.value}</span>
                {s.suffix}
              </p>
              <p data-stat-label className="label mt-3 max-w-[18rem] leading-relaxed text-ink-2">
                {s.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
