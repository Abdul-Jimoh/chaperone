"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishWalletLinkAction, startWalletLinkAction, walletClientToken } from "@/app/app/actions";
import type { Wallet } from "@/lib/app/wallet";

const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

type SaveSession = { start(options: { presentationMode: "auto" }, setup: Promise<{ vaultSetupToken: string }>): Promise<void> };
type PayPalSdk = {
  findEligibleMethods(options: { currencyCode: string; paymentFlow: "VAULT_WITHOUT_PAYMENT" }): Promise<{ isEligible(method: "paypal"): boolean }>;
  createPayPalSavePaymentSession(callbacks: {
    onApprove(data: { vaultSetupToken: string }): Promise<void>;
    onCancel(): void;
    onError(error: unknown): void;
  }): SaveSession;
};

declare global {
  interface Window {
    paypal?: { createInstance(options: { clientToken: string; components: string[]; pageType: string }): Promise<PayPalSdk> };
  }
}

let sdkScript: Promise<void> | undefined;
function loadSdk(): Promise<void> {
  sdkScript ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement("script"), { src: SDK_URL, async: true, onload: () => resolve(), onerror: () => reject(new Error("sdk")) });
    document.head.appendChild(script);
  });
  return sdkScript;
}

type State = { step: "loading" | "ready" | "working" } | { step: "unavailable"; error: string } | { step: "failed"; error: string };

/** PayPal's own button (JS SDK v6, save without purchase): the shopper approves in PayPal and the wallet is vaulted (Vault v3). */
export function LinkPayPal({ wallet }: { wallet: Wallet }) {
  const router = useRouter();
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ step: "loading" });
  const [linked, setLinked] = useState(wallet.kind === "own" ? wallet.email : null);

  useEffect(() => {
    let cancelled = false;
    let button: HTMLElement | undefined;
    (async () => {
      const token = await walletClientToken();
      if (!token.ok) throw new Error(token.error);
      await loadSdk();
      const sdk = await window.paypal!.createInstance({ clientToken: token.clientToken, components: ["paypal-payments"], pageType: "checkout" });
      const methods = await sdk.findEligibleMethods({ currencyCode: "USD", paymentFlow: "VAULT_WITHOUT_PAYMENT" });
      if (cancelled) return;
      if (!methods.isEligible("paypal")) return setState({ step: "unavailable", error: "PayPal can't save a wallet in this browser." });

      let ticket = "";
      const session = sdk.createPayPalSavePaymentSession({
        async onApprove({ vaultSetupToken }) {
          const result = await finishWalletLinkAction(vaultSetupToken, ticket);
          if (!result.ok) return setState({ step: "failed", error: result.error });
          setLinked(result.email);
          setState({ step: "ready" });
          router.refresh();
        },
        onCancel: () => setState({ step: "ready" }),
        onError: () => setState({ step: "failed", error: "PayPal closed before the wallet was saved. Try again." }),
      });
      button = document.createElement("paypal-button");
      button.addEventListener("click", () => {
        setState({ step: "working" });
        // Started inside the click, so the browser lets PayPal open its window; the setup token follows as a promise.
        session
          .start(
            { presentationMode: "auto" },
            startWalletLinkAction().then((r) => {
              if ("refused" in r) throw new Error(r.refused);
              ticket = r.ticket;
              return { vaultSetupToken: r.setupToken };
            }),
          )
          .catch((error) => {
            const refused = error instanceof Error && error.message && !/popup|window/i.test(error.message) ? error.message : null;
            setState({ step: "failed", error: refused ?? "PayPal couldn't open. Allow pop-ups for this site and try again." });
          });
      });
      slot.current?.replaceChildren(button);
      setState({ step: "ready" });
    })().catch((error) => !cancelled && setState({ step: "unavailable", error: error instanceof Error && error.message !== "sdk" ? error.message : "PayPal's button didn't load." }));
    return () => {
      cancelled = true;
      button?.remove();
    };
  }, [router]);

  return (
    <div>
      {linked ? (
        <p className="flex items-start gap-3 leading-relaxed text-ink-2">
          <Tick />
          <span>
            Your own PayPal sandbox account is linked: <span className="font-medium text-ink">{linked}</span>. Holds are placed on it from now on.
          </span>
        </p>
      ) : wallet.kind === "demo" ? (
        <p className="flex items-start gap-3 leading-relaxed text-ink-2">
          <Tick />
          This demo starts with a PayPal sandbox buyer whose wallet is already saved, so the agent can pay while you&apos;re away. Every payment still
          needs your rules to pass.
        </p>
      ) : (
        <p className="leading-relaxed text-ink-2">
          Link a PayPal sandbox personal account once, so the agent can pay while you&apos;re away. Every payment still needs your rules to pass.
        </p>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[0.95rem] text-ink-2">{linked ? "Link a different sandbox account:" : wallet.kind === "demo" ? "Or link your own PayPal sandbox account:" : "Link it with PayPal:"}</p>
        <div ref={slot} className={`mt-3 max-w-sm ${state.step === "working" ? "pointer-events-none opacity-60" : ""}`} aria-busy={state.step !== "ready"} />
        {state.step === "loading" && <p className="mt-3 h-11 animate-pulse rounded-full bg-paper-2" aria-hidden />}
        {(state.step === "failed" || state.step === "unavailable") && (
          <p role="alert" className="mt-3 text-[0.92rem] text-accent-ink">
            {state.error}
          </p>
        )}
      </div>
    </div>
  );
}

function Tick() {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-mint text-go" aria-hidden>
      ✓
    </span>
  );
}
