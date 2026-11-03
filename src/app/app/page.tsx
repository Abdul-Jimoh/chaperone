import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { Dashboard } from "@/components/app/Dashboard";
import { Onboarding } from "@/components/app/Onboarding";
import { StartScreen } from "@/components/app/StartScreen";
import { dashboard, demoDraft } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { demoWorld, serverDb } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo" };

export default async function AppPage() {
  const userId = await sessionUserId();
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
