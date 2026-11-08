import Link from "next/link";
import type { ReactNode } from "react";
import { endDemo } from "@/app/app/actions";
import type { AppData } from "@/app/app/data";
import { Logo } from "@/components/brand/Logo";
import { formatCents } from "@/lib/policy/describe";
import { LiveRefresh } from "./LiveRefresh";
import { SideNav, type NavItem } from "./SideNav";
import { Meter } from "./ui";

function SandboxTag() {
  return (
    <span className="label inline-flex items-center gap-2 rounded-full border border-line-strong px-2.5 py-1 text-ink-2">
      <span className="size-1.5 rounded-full bg-accent" /> Sandbox demo
    </span>
  );
}

function EndDemo({ className = "" }: { className?: string }) {
  return (
    <form action={endDemo}>
      <button type="submit" className={`rounded-full text-[0.92rem] text-ink-2 hover:text-ink ${className}`}>
        End demo
      </button>
    </form>
  );
}

/** The signed-in app: a sidebar with where you are and what your rules allow, and one job per page. */
export function AppShell({ data, children }: { data: AppData; children: ReactNode }) {
  const { mandate, spent, waiting } = data;
  const active = mandate.status === "active";
  const month = mandate.policy.budgets.find((b) => b.period === "month");
  const items: NavItem[] = [
    { href: "/app", label: "Overview", icon: "overview" },
    { href: "/app/shop", label: "Shop", icon: "shop" },
    { href: "/app/approvals", label: "Approvals", icon: "approvals", badge: waiting.length },
    { href: "/app/ledger", label: "Ledger", icon: "ledger" },
    { href: "/app/rules", label: "Rules", icon: "rules" },
    { href: "/app/connect", label: "Connect an agent", icon: "connect" },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <LiveRefresh waiting={waiting.length > 0} />
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-4 py-6 lg:flex">
        <div className="px-3">
          <Link href="/" aria-label="Chaperone home" className="text-[1.05rem]">
            <Logo />
          </Link>
          <div className="mt-4">
            <SandboxTag />
          </div>
        </div>
        <div className="mt-8">
          <SideNav items={items} layout="column" />
        </div>
        <div className="mt-auto space-y-4">
          <Link href="/app/rules" className="block rounded-2xl border border-line p-4 hover:border-line-strong">
            <p className="flex items-center gap-2 text-[0.88rem] font-medium">
              <span className={`size-2 rounded-full ${active ? "bg-go" : "bg-ink"}`} />
              {active ? "Rules active" : "Rules revoked"}
            </p>
            {month && (
              <>
                <p className="mt-3 text-[0.8rem] text-ink-2">This month</p>
                <p className="mt-0.5 text-[0.95rem] font-semibold tracking-[-0.02em]">
                  {formatCents(spent.month ?? 0)} <span className="font-normal text-ink-2">of {formatCents(month.limitCents)}</span>
                </p>
                <div className="mt-2">
                  <Meter used={spent.month ?? 0} limit={month.limitCents} />
                </div>
              </>
            )}
          </Link>
          <EndDemo className="px-3 py-1" />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-paper lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-5 sm:px-8">
            <Link href="/" aria-label="Chaperone home">
              <Logo />
            </Link>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex">
                <SandboxTag />
              </span>
              <EndDemo />
            </div>
          </div>
          <SideNav items={items} layout="row" />
        </header>
        <main className="mx-auto w-full max-w-330 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">{children}</main>
      </div>
    </div>
  );
}
