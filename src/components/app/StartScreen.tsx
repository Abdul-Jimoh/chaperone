import { startDemo } from "@/app/app/actions";
import { SubmitButton } from "./SubmitButton";

const STEPS = [
  { n: "01", title: "A demo shopper", body: "You get a private shopper with a PayPal sandbox wallet already linked. No sign-up, no real money." },
  { n: "02", title: "Your rules", body: "Confirm a short set of shopping rules. Nothing is enforced until you do." },
  { n: "03", title: "Purchases, checked", body: "Let the agent try three purchases and watch one go through, one wait for you, and one get blocked." },
];

export function StartScreen({ error }: { error?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
      <p className="label text-ink-2">Try it</p>
      <h1 className="display mt-4 max-w-3xl text-[clamp(2.4rem,6vw,4.8rem)]">See Chaperone check a real sandbox purchase.</h1>
      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="border-t border-line-strong pt-5">
            <p className="label text-accent-ink">{s.n}</p>
            <h2 className="mt-3 text-[1.3rem] font-semibold tracking-[-0.03em]">{s.title}</h2>
            <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
      <form action={startDemo} className="mt-12">
        <SubmitButton pending="Setting up your demo…" className="h-12 px-7 text-[1.02rem]">
          Start the demo <span aria-hidden>→</span>
        </SubmitButton>
      </form>
      {error && <p className="mt-4 text-accent-ink">{error}</p>}
    </div>
  );
}
