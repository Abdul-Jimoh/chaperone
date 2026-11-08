"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  overview: "M4 5h7v6H4zM13 5h7v3h-7zM13 10h7v9h-7zM4 13h7v6H4z",
  shop: "M5 8h14l-1.2 11H6.2zM9 8V6.5a3 3 0 0 1 6 0V8",
  approvals: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.2l2.4 2.4 4.6-5",
  ledger: "M5 5h14M5 10h14M5 15h14M5 20h9",
  rules: "M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6zM9 12l2 2 4-4",
  connect: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5",
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4.5 shrink-0">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function SideNav({ items, layout }: { items: NavItem[]; layout: "column" | "row" }) {
  const path = usePathname();
  const current = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  return (
    <nav aria-label="App" className={layout === "column" ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto px-5 pb-3 scrollbar-none sm:px-8"}>
      {items.map((item) => {
        const on = current(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 rounded-xl px-3 text-[0.95rem] whitespace-nowrap transition-colors ${
              layout === "column" ? "h-10" : "h-9 border border-line"
            } ${on ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink"}`}
          >
            <Icon name={item.icon} />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[0.72rem] font-semibold ${on ? "bg-paper text-ink" : "bg-accent text-paper"}`}>
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
