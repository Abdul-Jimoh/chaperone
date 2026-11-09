import { isCronRequest } from "@/lib/cron";
import { requireEnv } from "@/lib/env";
import { sweepApprovals } from "@/lib/payments/approvals";
import { pruneRateLimits } from "@/lib/ratelimit";
import { paymentDeps, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each resumed payment can wait on PayPal (15 s timeout per call); a run that is cut off is picked up the next day.
export const maxDuration = 60;

// Backstop for approvals nobody looks at (everything else sweeps lazily on each read and request); also drops old rate-limit windows.
export const GET = withConfigCheck(async (request: Request): Promise<Response> => {
  if (!isCronRequest(request, requireEnv("CRON_SECRET"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const deps = paymentDeps();
  const swept = await sweepApprovals(deps, { resumeLimit: 10 });
  await pruneRateLimits(deps.db);
  return Response.json({ swept: swept.map((p) => ({ id: p.id, status: p.status })) });
});
