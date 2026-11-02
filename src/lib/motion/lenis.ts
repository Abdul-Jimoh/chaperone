"use client";

import type Lenis from "lenis";

let instance: Lenis | null = null;

export function setLenis(lenis: Lenis | null) {
  instance = lenis;
}

/** Smooth-scrolls when Lenis is running (it isn't under reduced motion), otherwise jumps. */
export function scrollToTarget(target: string | HTMLElement | number, offset = 0) {
  if (instance) {
    instance.scrollTo(target, { offset, duration: 1.4 });
    return;
  }
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (typeof el === "number") window.scrollTo({ top: el + offset });
  else el?.scrollIntoView();
}
