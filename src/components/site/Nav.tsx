"use client";

import { useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { scrollToTarget } from "@/lib/motion/lenis";
import { Clock } from "./Clock";

const LINKS = [
  { href: "#mandate", label: "Mandates" },
  { href: "#flow", label: "How a payment works" },
  { href: "#untrusted", label: "Safety" },
  { href: "#developers", label: "Developers" },
];

export function Nav() {
  const root = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        gsap.from("[data-clasp]", { drawSVG: "50% 50%", duration: 1.2, ease: "hold", delay: 0.15 });
        gsap.from("[data-coin]", { scale: 0, transformOrigin: "50% 50%", duration: 0.7, ease: "back.out(3)", delay: 0.75 });
        gsap.from("[data-nav-item]", { y: -16, autoAlpha: 0, stagger: 0.05, duration: 0.8, ease: "hold", delay: 0.3 });
        const hide = gsap.to(root.current, { yPercent: -120, duration: 0.45, ease: "power3.out", paused: true });
        ScrollTrigger.create({
          start: 120,
          end: "max",
          onUpdate: (self) => (self.direction === 1 ? hide.play() : hide.reverse()),
        });
      });
      ScrollTrigger.create({
        start: 40,
        end: "max",
        toggleClass: { targets: root.current, className: "is-scrolled" },
      });
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (!menu.current) return;
      const items = menu.current.querySelectorAll("[data-menu-item]");
      if (open) {
        gsap.set(menu.current, { display: "flex" });
        gsap.fromTo(menu.current, { clipPath: "circle(0% at 92% 4%)" }, { clipPath: "circle(150% at 92% 4%)", duration: 0.8, ease: "power3.inOut" });
        gsap.fromTo(items, { yPercent: 110 }, { yPercent: 0, stagger: 0.06, duration: 0.8, ease: "hold", delay: 0.25 });
      } else if (menu.current.style.display === "flex") {
        gsap.to(menu.current, {
          clipPath: "circle(0% at 92% 4%)",
          duration: 0.6,
          ease: "power3.inOut",
          onComplete: () => void gsap.set(menu.current, { display: "none" }),
        });
      }
    },
    { dependencies: [open] },
  );

  function go(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    setOpen(false);
    scrollToTarget(href, -24);
  }

  return (
    <>
      <header
        ref={root}
        className="group fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4 [&.is-scrolled_.nav-shell]:border-line [&.is-scrolled_.nav-shell]:bg-paper/80 [&.is-scrolled_.nav-shell]:backdrop-blur-md"
      >
        <nav className="nav-shell mx-auto flex max-w-[1680px] items-center justify-between gap-4 rounded-2xl border border-transparent px-3 py-2.5 transition-colors duration-500 sm:px-4">
          <a href="#top" onClick={(e) => go(e, "#top")} className="text-[1.05rem] text-ink" aria-label="Chaperone, back to top">
            <Logo />
          </a>
          <ul className="hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <li key={l.href} data-nav-item>
                <a href={l.href} onClick={(e) => go(e, l.href)} className="group/link relative text-[0.95rem] text-ink-2 transition-colors hover:text-ink">
                  {l.label}
                  <span className="absolute -bottom-1 left-0 h-px w-full origin-right scale-x-0 bg-ink transition-transform duration-500 ease-[var(--ease-hold)] group-hover/link:origin-left group-hover/link:scale-x-100" />
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <span data-nav-item className="label hidden items-center gap-2 text-ink-2 xl:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Sandbox · <Clock />
            </span>
            <a
              data-nav-item
              href="#flow"
              onClick={(e) => go(e, "#flow")}
              className="hidden items-center gap-2 rounded-full bg-ink px-4 py-2 text-[0.9rem] font-medium text-paper transition-transform duration-300 hover:scale-[1.03] sm:inline-flex"
            >
              See a purchase checked <span aria-hidden>↓</span>
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="relative z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-line-strong lg:hidden"
            >
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
              <span className={`absolute h-px w-4 bg-current transition-transform duration-500 ${open ? "rotate-45" : "-translate-y-1"}`} />
              <span className={`absolute h-px w-4 bg-current transition-transform duration-500 ${open ? "-rotate-45" : "translate-y-1"}`} />
            </button>
          </div>
        </nav>
      </header>
      <div
        ref={menu}
        id="mobile-menu"
        className="fixed inset-0 z-40 hidden flex-col justify-between bg-night px-6 pb-10 pt-28 text-paper lg:hidden"
        aria-hidden={!open}
      >
        <ul className="space-y-1">
          {LINKS.map((l, i) => (
            <li key={l.href} className="overflow-hidden">
              <a data-menu-item href={l.href} onClick={(e) => go(e, l.href)} className="flex items-baseline gap-4 py-2 text-[2.6rem] font-medium tracking-[-0.04em]">
                <span className="label text-paper/50">0{i + 1}</span>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="label text-paper/60">
          Sandbox only · <Clock />
        </p>
      </div>
    </>
  );
}
