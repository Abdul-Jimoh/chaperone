"use client";

import { useRef } from "react";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";

export function Marquee({ items, className = "", speed = 38 }: { items: string[]; className?: string; speed?: number }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        const loop = gsap.to("[data-track]", { xPercent: -50, duration: speed, ease: "none", repeat: -1 });
        // Start far into the loop so scrolling up can run it backwards without hitting the start.
        loop.totalTime(loop.duration() * 500);
        let direction = 1;
        ScrollTrigger.create({
          trigger: root.current,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => (self.isActive ? loop.play() : loop.pause()),
          onUpdate: (self) => {
            direction = self.direction;
            const boost = Math.min(Math.abs(self.getVelocity()) / 220, 6);
            gsap.to(loop, { timeScale: direction * (1 + boost), duration: 0.2, overwrite: true });
            gsap.to(loop, { timeScale: direction, duration: 1.2, delay: 0.2, ease: "power2.out" });
          },
        });
      });
    },
    { scope: root },
  );

  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {items.map((t, i) => (
        <span key={i} className="flex items-center">
          <span className="whitespace-nowrap px-[0.35em]">{t}</span>
          <span className="inline-block h-[0.62em] w-[0.62em] bg-accent" />
        </span>
      ))}
    </div>
  );

  return (
    <div ref={root} className={`overflow-hidden ${className}`}>
      <div data-track className="flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
