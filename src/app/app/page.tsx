import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { Dashboard } from "@/components/app/Dashboard";
import { Onboarding } from "@/components/app/Onboarding";
import { StartScreen } from "@/components/app/StartScreen";
import { dashboard, demoDraft } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { sweepApprovals } from "@/lib/payments/approvals";
import { demoWorld, paymentDeps, serverDb } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo" };

export default async function AppPage() {
  const userId = await sessionUserId();
  // Timeouts are applied lazily (D12): without this, an unanswered purchase would look like it's still waiting.
  if (userId) await sweepApprovals(paymentDeps()).catch((error) => console.warn("approval sweep failed:", error));
  const data = userId ? await dashboard(serverDb(), userId) : null;
  return (
    <>
      <AppHeader signedIn={Boolean(userId)} />
      <main>
        {!userId ? <StartScreen /> : data ? <Dashboard data={data} /> : <Onboarding {...demoDraft(demoWorld())} />}
      </main>
    </>
  );
}
