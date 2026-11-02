"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";

/** A ring that trails the pointer and swells over links. Fine pointers with motion only. */
export function Cursor() {
  const ring = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
      const el = ring.current!;
      gsap.set(el, { xPercent: -50, yPercent: -50, autoAlpha: 0 });
      const x = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3" });
      const y = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3" });
      const move = (e: PointerEvent) => {
        gsap.to(el, { autoAlpha: 1, duration: 0.3 });
        x(e.clientX);
        y(e.clientY);
        const hot = (e.target as Element | null)?.closest("a, button, [role=tab]");
        gsap.to(el, { scale: hot ? 2.2 : 1, duration: 0.35, ease: "power3.out" });
      };
      const leave = () => gsap.to(el, { autoAlpha: 0, duration: 0.3 });
      window.addEventListener("pointermove", move);
      document.documentElement.addEventListener("pointerleave", leave);
      return () => {
        window.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", leave);
      };
    });
  });

  return (
    <div
      ref={ring}
      aria-hidden="true"
      className="pointer-events-none invisible fixed left-0 top-0 z-[100] hidden h-8 w-8 rounded-full border border-accent mix-blend-multiply [@media(pointer:fine)]:block"
    />
  );
}
