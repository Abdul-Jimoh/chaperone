import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/AppHeader";
import { AppShell } from "@/components/app/AppShell";
import { appData } from "./data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { userId, data } = await appData();
  if (!data) {
    return (
      <>
        <AppHeader signedIn={Boolean(userId)} />
        <main>{children}</main>
      </>
    );
  }
  return <AppShell data={data}>{children}</AppShell>;
}
