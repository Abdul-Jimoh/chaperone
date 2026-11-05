import { StartForm } from "./StartForm";
import { SHELL } from "./ui";

const STEPS = [
  { n: "01", title: "A demo shopper", body: "You get a private shopper with a PayPal sandbox wallet already linked. No sign-up, no real money." },
  { n: "02", title: "Your rules", body: "Confirm a short set of shopping rules. Nothing is enforced until you do." },
  { n: "03", title: "Purchases, checked", body: "Let the agent try three purchases and watch one go through, one wait for you, and one get blocked." },
];

export function StartScreen() {
  return (
    <div className={`${SHELL} py-16 lg:py-24`}>
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <p className="label text-ink-2">Try it</p>
          <h1 className="display mt-4 text-[clamp(2.6rem,6.4vw,6.5rem)]">See Chaperone check a real sandbox purchase.</h1>
        </div>
        <div className="lg:col-span-4 lg:pb-3">
          <p className="mb-6 max-w-md text-[1.05rem] leading-relaxed text-ink-2">
            About two minutes. Every purchase is a real PayPal sandbox hold, checked against rules you confirm.
          </p>
          <StartForm />
        </div>
      </div>
      <ol className="mt-16 grid gap-8 md:grid-cols-3 lg:mt-24">
        {STEPS.map((s) => (
          <li key={s.n} className="border-t border-line-strong pt-5">
            <p className="label text-accent-ink">{s.n}</p>
            <h2 className="mt-3 text-[1.35rem] font-semibold tracking-[-0.03em]">{s.title}</h2>
            <p className="mt-2 max-w-md leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
