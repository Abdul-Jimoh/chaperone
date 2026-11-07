import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { Card, SHELL } from "@/components/app/ui";
import { activeMandate } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { requireEnv } from "@/lib/env";
import { checkAuthorize } from "@/lib/oauth";
import { endpoints } from "@/lib/oauth-http";
import { describePolicy } from "@/lib/policy/describe";
import { serverDb } from "@/lib/server";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an agent" };

function Shell({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  return (
    <>
      <AppHeader signedIn={signedIn} />
      <main className={`${SHELL} py-12 lg:py-16`}>
        <div className="max-w-3xl">{children}</div>
      </main>
    </>
  );
}

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const check = checkAuthorize(requireEnv("APPROVAL_LINK_SECRET"), (await endpoints()).resource, params);
  const userId = await sessionUserId();
  if (!check.ok) {
    return (
      <Shell signedIn={Boolean(userId)}>
        <p className="label text-ink-2">Connect an agent</p>
        <h1 className="display mt-4 text-[clamp(2rem,4.4vw,3.4rem)]">This link can&apos;t be used.</h1>
        <p className="mt-4 text-[1.05rem] text-ink-2">{check.show}</p>
      </Shell>
    );
  }

  const { client, redirectUri } = check.request;
  const mandate = userId ? await activeMandate(serverDb(), userId) : null;
  if (!mandate) {
    return (
      <Shell signedIn={Boolean(userId)}>
        <p className="label text-ink-2">Connect an agent</p>
        <h1 className="display mt-4 text-[clamp(2rem,4.4vw,3.4rem)]">Sign your rules first.</h1>
        <p className="mt-4 text-[1.05rem] leading-relaxed text-ink-2">
          &ldquo;{client.name}&rdquo; wants to pay through Chaperone. An agent can only pay under rules you&apos;ve signed, and you don&apos;t have any in
          this browser yet.
        </p>
        <ol className="mt-6 space-y-2 text-[1.05rem]">
          <li>
            1.{" "}
            <a href="/app" target="_blank" rel="noopener" className="font-medium underline underline-offset-4 hover:text-accent-ink">
              Open the demo in a new tab
            </a>{" "}
            and confirm your rules.
          </li>
          <li>2. Come back to this tab and continue.</li>
        </ol>
        <a href="" className="mt-8 inline-flex h-12 items-center rounded-full bg-ink px-7 font-medium text-paper hover:bg-accent">
          I&apos;ve signed my rules, continue
        </a>
      </Shell>
    );
  }

  return (
    <Shell signedIn>
      <p className="label text-ink-2">Connect an agent</p>
      <h1 className="display mt-4 text-[clamp(2rem,4.4vw,3.4rem)]">Let &ldquo;{client.name}&rdquo; pay under your rules?</h1>
      <p className="mt-4 text-ink-2">
        That&apos;s the name the app gave itself. After you answer, it continues at {new URL(redirectUri).host}.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card label="It can" title="Shop under these rules">
          <ul className="space-y-2 text-[0.95rem]">
            {describePolicy(mandate.policy).map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                {line}
              </li>
            ))}
          </ul>
        </Card>
        <Card label="It can't" title="Go around them">
          <ul className="space-y-2 text-[0.95rem] text-ink-2">
            <li>Change your rules or pick looser ones.</li>
            <li>See your PayPal details.</li>
            <li>Pay a shop you didn&apos;t list, or more than your limits.</li>
            <li>Approve its own purchases. Anything over your line waits for you.</li>
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-[0.95rem] text-ink-2">You can disconnect it from your dashboard at any time. Revoking your rules stops it too.</p>
      <ConsentForm params={params} />
    </Shell>
  );
}
