import { isCronRequest } from "@/lib/cron";
import { requireEnv } from "@/lib/env";
import { sweepApprovals } from "@/lib/payments/approvals";
import { paymentDeps, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backstop for approvals nobody looks at: everything else sweeps lazily on each read and request.
export const GET = withConfigCheck(async (request: Request): Promise<Response> => {
  if (!isCronRequest(request, requireEnv("CRON_SECRET"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await sweepApprovals(paymentDeps());
  return Response.json({ swept: swept.map((p) => ({ id: p.id, status: p.status })) });
});
