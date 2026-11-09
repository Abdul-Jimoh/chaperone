import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { dashboard } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { sweepApprovals } from "@/lib/payments/approvals";
import { hit, LIMITS } from "@/lib/ratelimit";
import { paymentDeps, serverDb } from "@/lib/server";

export type AppData = NonNullable<Awaited<ReturnType<typeof dashboard>>>;

/** Once per request, shared by the layout and the page. */
export const appData = cache(async () => {
  const userId = await sessionUserId();
  if (!userId) return { userId: null, data: null };
  // Timeouts are applied lazily (D12): without this, an unanswered purchase would look like it's still waiting.
  // At most once a minute across all visitors, so a void that keeps failing isn't retried by every render.
  await (async () => {
    if ((await hit(serverDb(), [[LIMITS.pageSweep, null]])).ok) await sweepApprovals(paymentDeps(), { resumeLimit: 3 });
  })().catch((error) => console.warn("approval sweep failed:", error));
  return { userId, data: await dashboard(serverDb(), userId) };
});

/** For the pages that only make sense once the rules are signed. */
export async function requireData(): Promise<AppData> {
  const { data } = await appData();
  if (!data) redirect("/app");
  return data;
}
