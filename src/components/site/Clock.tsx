"use client";

import { useEffect, useState } from "react";

export function Clock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () => new Date().toISOString().slice(11, 19);
    setNow(fmt());
    const id = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={`tabular-nums ${className}`} aria-label="Current time, UTC">
      {now ?? "--:--:--"} UTC
    </span>
  );
}
