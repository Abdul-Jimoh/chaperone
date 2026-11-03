"use client";

import { useFormStatus } from "react-dom";

const STYLES = {
  primary: "bg-ink text-paper hover:bg-accent",
  secondary: "border border-line-strong hover:border-ink",
  danger: "bg-accent text-paper hover:bg-accent-ink",
};

export function SubmitButton({ children, pending, variant = "primary", className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: string; variant?: keyof typeof STYLES }) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      disabled={status.pending}
      className={`inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${STYLES[variant]} ${className}`}
      {...rest}
    >
      {status.pending ? (pending ?? "Working…") : children}
    </button>
  );
}
