"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { lockScroll, scrollToTarget } from "@/lib/motion/lenis";
import { Clock } from "./Clock";

const LINKS = [
  { href: "#mandate", label: "Mandates" },
  { href: "#flow", label: "How it works" },
  { href: "#untrusted", label: "Safety" },
  { href: "#developers", label: "Developers" },
];

export function Nav() {
  const root = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-clasp]", { drawSVG: "50% 50%", duration: 1.2, ease: "hold", delay: 0.15 });
        gsap.from("[data-coin]", { scale: 0, transformOrigin: "50% 50%", duration: 0.7, ease: "back.out(3)", delay: 0.75 });
      });
      ScrollTrigger.create({ start: 40, end: "max", toggleClass: { targets: root.current, className: "is-scrolled" } });
    },
    { scope: root },
  );

  useGSAP(
    () => {
      const el = sheet.current!;
      const links = el.querySelectorAll("[data-menu-item]");
      if (open) {
        gsap.set(el, { display: "flex" });
        gsap.fromTo(el, { yPercent: -100 }, { yPercent: 0, duration: 0.6, ease: "power3.out" });
        gsap.fromTo(links, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.05, ease: "power3.out", delay: 0.15 });
      } else if (el.style.display === "flex") {
        gsap.to(el, { yPercent: -100, duration: 0.45, ease: "power3.in", onComplete: () => void gsap.set(el, { display: "none" }) });
      }
    },
    { dependencies: [open] },
  );

  useEffect(() => {
    lockScroll(open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function go(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    setOpen(false);
    // Wait for the sheet to leave and scrolling to unlock before moving.
    setTimeout(() => scrollToTarget(href, -16), open ? 350 : 0);
  }

  return (
    <>
      <header
        ref={root}
        data-open={open || undefined}
        className="group fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4 data-[open]:text-paper [&.is-scrolled:not([data-open])_.nav-shell]:border-line [&.is-scrolled:not([data-open])_.nav-shell]:bg-paper/85 [&.is-scrolled:not([data-open])_.nav-shell]:backdrop-blur-md"
      >
        <nav className="nav-shell mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 rounded-2xl border border-transparent px-3 transition-colors duration-300 sm:px-4">
          <a href="#top" onClick={(e) => go(e, "#top")} className="shrink-0 text-[1.05rem]" aria-label="Chaperone, back to top">
            <Logo />
          </a>
          <ul className="hidden items-center gap-8 lg:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={(e) => go(e, l.href)} className="text-[0.95rem] text-ink-2 transition-colors hover:text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4">
            <span className="label hidden items-center gap-2 text-ink-2 xl:inline-flex">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Sandbox · <Clock />
            </span>
            <a
              href="#flow"
              onClick={(e) => go(e, "#flow")}
              className="hidden h-10 items-center gap-2 rounded-full bg-ink px-4 text-[0.9rem] font-medium text-paper transition-colors hover:bg-accent sm:inline-flex"
            >
              See a purchase checked <span aria-hidden>↓</span>
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="relative flex h-11 w-11 items-center justify-center rounded-full border border-current/25 lg:hidden"
            >
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
              <span
                className="absolute h-[1.5px] w-[18px] bg-current transition-transform duration-300 ease-out"
                style={{ transform: open ? "rotate(45deg)" : "translateY(-4px)" }}
              />
              <span
                className="absolute h-[1.5px] w-[18px] bg-current transition-transform duration-300 ease-out"
                style={{ transform: open ? "rotate(-45deg)" : "translateY(4px)" }}
              />
            </button>
          </div>
        </nav>
      </header>

      <div
        ref={sheet}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-0 z-40 hidden flex-col bg-night px-5 pb-8 pt-24 text-paper sm:px-8 lg:hidden"
      >
        <ul className="flex-1">
          {LINKS.map((l, i) => (
            <li key={l.href} data-menu-item className="border-b border-night-line">
              <a href={l.href} onClick={(e) => go(e, l.href)} className="flex items-center justify-between py-5">
                <span className="flex items-baseline gap-4">
                  <span className="label text-paper/45">0{i + 1}</span>
                  <span className="text-[clamp(1.8rem,8vw,2.6rem)] font-medium tracking-[-0.035em]">{l.label}</span>
                </span>
                <span aria-hidden className="text-paper/50">→</span>
              </a>
            </li>
          ))}
        </ul>
        <div data-menu-item className="space-y-5">
          <a
            href="#flow"
            onClick={(e) => go(e, "#flow")}
            className="flex h-12 items-center justify-center rounded-full bg-paper text-[1rem] font-medium text-ink"
          >
            See a purchase checked
          </a>
          <p className="label flex items-center justify-center gap-2 text-paper/55">
            <span className="h-2 w-2 rounded-full bg-accent" /> PayPal sandbox · <Clock />
          </p>
        </div>
      </div>
    </>
  );
}
