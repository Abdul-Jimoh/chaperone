"use client";

import { useRef } from "react";
import { gsap, MOTION, REDUCED, SplitText, useGSAP } from "@/lib/motion/gsap";

type Props = {
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  children: React.ReactNode;
  className?: string;
  /** "lines" slides masked lines up; "chars" for display type; "words" fades word by word. */
  by?: "lines" | "chars" | "words";
  delay?: number;
  /** Play on mount instead of when scrolled into view. */
  immediate?: boolean;
};

export function Reveal({ as: Tag = "div", children, className = "", by = "lines", delay = 0, immediate = false }: Props) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current!;
      const mm = gsap.matchMedia();
      mm.add(REDUCED, () => void gsap.set(el, { autoAlpha: 1 }));
      mm.add(MOTION, () => {
        gsap.set(el, { autoAlpha: 1 });
        const split = SplitText.create(el, {
          type: by === "chars" ? "lines,chars" : by === "words" ? "lines,words" : "lines",
          mask: "lines",
          autoSplit: true,
          onSplit(self) {
            // Masks clip at the line box; tight display leading would cut descenders without this.
            gsap.set(self.masks, { paddingBottom: "0.14em", marginBottom: "-0.14em" });
            const targets = by === "chars" ? self.chars : by === "words" ? self.words : self.lines;
            return gsap.from(targets, {
              yPercent: 115,
              rotate: by === "chars" ? 6 : 0,
              duration: by === "chars" ? 1.1 : 1,
              ease: "hold",
              stagger: by === "chars" ? 0.018 : by === "words" ? 0.03 : 0.09,
              delay,
              scrollTrigger: immediate ? undefined : { trigger: el, start: "top 88%", once: true },
            });
          },
        });
        return () => split.revert();
      });
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref as never} data-reveal className={className}>
      {children}
    </Tag>
  );
}
