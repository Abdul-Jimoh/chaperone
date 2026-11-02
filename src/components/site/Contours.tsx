"use client";

import { useRef } from "react";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";

const W = 1440;
const H = 900;
const LINES = 12;
const BOLD = 7;

function smooth(points: [number, number][]) {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** A topographic line field: the agent's wandering path, flattened by the rules as you scroll. */
function line(i: number, phase: number, calm: number) {
  const pts: [number, number][] = [];
  const amp = 1 - calm * 0.85;
  for (let x = -80; x <= W + 80; x += 60) {
    const y0 = 250 + i * 34;
    const hill = -170 * Math.exp(-(((x - 980) / 300) ** 2)) * (1 - i / (LINES + 4));
    const wave = Math.sin(x * 0.0042 + phase + i * 0.42) * 38 + Math.sin(x * 0.011 - phase * 1.4 + i * 0.9) * 12;
    pts.push([x, y0 + (hill + wave) * amp]);
  }
  return smooth(pts);
}

export function Contours({ className = "" }: { className?: string }) {
  const root = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const paths = gsap.utils.toArray<SVGPathElement>("[data-line]", root.current);
      const trail = root.current!.querySelector<SVGPathElement>("[data-trail]")!;
      const state = { phase: 0, calm: 0 };
      const draw = () => {
        paths.forEach((p, i) => p.setAttribute("d", line(i, state.phase, state.calm)));
        trail.setAttribute("d", line(BOLD - 2, state.phase, state.calm));
      };
      draw();

      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from(paths, { drawSVG: "0%", duration: 2.2, stagger: 0.06, ease: "power2.inOut" });
        const tick = (_t: number, dt: number) => {
          state.phase += dt * 0.00018;
          draw();
        };
        const st = ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
          onUpdate: (self) => (state.calm = self.progress),
          onToggle: (self) => (self.isActive ? gsap.ticker.add(tick) : gsap.ticker.remove(tick)),
        });
        if (st.isActive) gsap.ticker.add(tick);
        gsap.to(trail, { strokeDashoffset: -240, duration: 6, repeat: -1, ease: "none" });
        return () => gsap.ticker.remove(tick);
      });
    },
    { scope: root },
  );

  return (
    <svg ref={root} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={`max-lg:opacity-60 ${className}`} aria-hidden="true">
      {Array.from({ length: LINES }, (_, i) => (
        <path
          key={i}
          data-line
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity={i === BOLD ? 0.75 : 0.13 + (i % 3) * 0.03}
          strokeWidth={i === BOLD ? 4 : 1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path data-trail className="max-lg:opacity-40" fill="none" stroke="var(--color-accent)" strokeWidth={5} strokeLinecap="round" strokeDasharray="3 18 26 18" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
