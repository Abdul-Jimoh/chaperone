import Link from "next/link";
import { endDemo } from "@/app/app/actions";
import { Logo } from "@/components/brand/Logo";

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="Chaperone home" className="text-[1.05rem]">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {signedIn && (
            <>
              <Link href="/app" className="rounded-full px-3 py-2 text-[0.95rem] text-ink-2 hover:text-ink">
                Dashboard
              </Link>
              <Link href="/app/ledger" className="rounded-full px-3 py-2 text-[0.95rem] text-ink-2 hover:text-ink">
                Ledger
              </Link>
            </>
          )}
          <span className="label ml-2 hidden items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-ink-2 sm:inline-flex">
            <span className="size-2 rounded-full bg-accent" /> Sandbox demo
          </span>
          {signedIn && (
            <form action={endDemo}>
              <button type="submit" className="rounded-full px-3 py-2 text-[0.95rem] text-ink-2 hover:text-ink">
                End demo
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
