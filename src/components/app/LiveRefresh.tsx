"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Approvals happen on another device and MCP agents pay from another process, so the dashboard
 * re-reads itself: on return to the tab, and every few seconds while something is waiting.
 */
export function LiveRefresh({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && router.refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = waiting ? window.setInterval(refresh, 4000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [router, waiting]);
  return null;
}
