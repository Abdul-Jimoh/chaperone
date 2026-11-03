"use client";

import { useRef } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { gsap, MOTION, SplitText, useGSAP } from "@/lib/motion/gsap";
import { scrollToTarget } from "@/lib/motion/lenis";
import { Clock } from "./Clock";

export function Footer() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION, () => {
        const split = SplitText.create("[data-wordmark]", { type: "chars", mask: "chars" });
        gsap.set(split.masks, { paddingBottom: "0.1em", marginBottom: "-0.1em" });
        gsap.from(split.chars, {
          yPercent: 100,
          stagger: 0.04,
          duration: 1.2,
          ease: "hold",
          scrollTrigger: { trigger: "[data-wordmark]", start: "top 95%", once: true },
        });
        gsap.from("[data-foot-mark]", {
          rotate: -180,
          scale: 0.4,
          duration: 1.4,
          ease: "hold",
          scrollTrigger: { trigger: "[data-wordmark]", start: "top 95%", once: true },
        });
        return () => split.revert();
      });
    },
    { scope: root },
  );

  return (
    <footer ref={root} className="relative overflow-hidden bg-night text-paper">
      <div className="relative mx-auto max-w-[1680px] px-5 pt-20 sm:px-8">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-6">
            <p className="max-w-md text-[clamp(1.6rem,2.6vw,2.4rem)] font-medium leading-[1.05] tracking-[-0.04em]">
              Let the agent shop. Keep the last word on the money.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6 md:col-span-6">
            <ul className="space-y-2 text-paper/75">
              {[
                ["#mandate", "Mandates"],
                ["#flow", "How it works"],
                ["#untrusted", "Safety"],
                ["#developers", "Developers"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToTarget(href!, -24);
                    }}
                    className="transition-colors hover:text-paper"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="space-y-2 text-paper/75">
              <p className="label text-paper/50">Status</p>
              <p>PayPal sandbox only. No real money moves.</p>
              <p className="label pt-2 text-paper/50">
                <Clock />
              </p>
            </div>
          </div>
        </div>

        <div className="mt-16 flex items-end gap-[2vw] pb-[4vw]">
          <LogoMark data-foot-mark className="mb-[2.2vw] h-[13vw] w-[13vw] shrink-0 text-paper" />
          <p data-wordmark aria-hidden="true" className="select-none text-[15vw] font-semibold leading-[0.8] tracking-[-0.035em]">
            chaperone
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-night-line py-6 text-paper/55">
          <span className="label">Built for the PayPal AI Hackathon · MIT licence</span>
          <button type="button" onClick={() => scrollToTarget(0)} className="label transition-colors hover:text-paper">
            ↑ Back to top
          </button>
        </div>
      </div>
    </footer>
  );
}
