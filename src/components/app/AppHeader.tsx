import Link from "next/link";
import { endDemo } from "@/app/app/actions";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { SHELL } from "./ui";

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line">
      <div className={`${SHELL} flex h-16 items-center justify-between gap-4`}>
        <Link href="/" aria-label="Chaperone home" className="text-[1.05rem]">
          {signedIn ? (
            <>
              <span className="sm:hidden">
                <LogoMark className="size-7" />
              </span>
              <span className="hidden sm:inline">
                <Logo />
              </span>
            </>
          ) : (
            <Logo />
          )}
        </Link>
        <nav className="flex items-center sm:gap-2">
          {signedIn && (
            <>
              <Link href="/app" className="whitespace-nowrap rounded-full px-2 py-2 text-[0.95rem] text-ink-2 hover:text-ink sm:px-3">
                Dashboard
              </Link>
              <Link href="/app/ledger" className="whitespace-nowrap rounded-full px-2 py-2 text-[0.95rem] text-ink-2 hover:text-ink sm:px-3">
                Ledger
              </Link>
            </>
          )}
          <span className="label ml-2 hidden items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-ink-2 sm:inline-flex">
            <span className="size-2 rounded-full bg-accent" /> Sandbox demo
          </span>
          {signedIn && (
            <form action={endDemo}>
              <button type="submit" className="whitespace-nowrap rounded-full px-2 py-2 text-[0.95rem] text-ink-2 hover:text-ink sm:px-3">
                End demo
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
