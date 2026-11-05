"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const FAST_MS = 4_000;
const SLOW_MS = 30_000;
const FAST_FOR_MS = 10 * 60_000;

/**
 * Approvals happen on another device and MCP agents pay from another process, so the dashboard
 * re-reads itself: on return to the tab, and while something is waiting (quickly at first, then
 * slowly, since a purchase can wait up to a day).
 */
export function LiveRefresh({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1_000) return;
      last = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    let timer: number | undefined;
    if (waiting) {
      const started = Date.now();
      const tick = () => {
        refresh();
        timer = window.setTimeout(tick, Date.now() - started < FAST_FOR_MS ? FAST_MS : SLOW_MS);
      };
      timer = window.setTimeout(tick, FAST_MS);
    }
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearTimeout(timer);
    };
  }, [router, waiting]);
  return null;
}
