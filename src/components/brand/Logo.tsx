import type { SVGProps } from "react";

/**
 * The clasp: an open ring holding a dot. The ring is the hold, the dot is the money.
 * Geometry is shared with the morphing glyph on the landing page (see shapes.ts).
 */
export const CLASP_PATH = "M24.43 8.93A11 11 0 1 0 24.43 23.07";

export function LogoMark({ dot = "var(--color-accent)", ...props }: SVGProps<SVGSVGElement> & { dot?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path data-clasp d={CLASP_PATH} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      <circle data-coin cx={16} cy={16} r={4.25} fill={dot} />
    </svg>
  );
}

export function Logo({ className = "", label = true }: { className?: string; label?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className="h-[1.35em] w-[1.35em]" />
      {label && <span className="font-sans text-[1.15em] font-semibold tracking-[-0.045em]">chaperone</span>}
    </span>
  );
}
