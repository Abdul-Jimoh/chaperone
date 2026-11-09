import { endpoints } from "@/lib/oauth-http";
import { handleMcpRequest } from "@/mcp/http";
import { demoCatalog } from "@/lib/catalog";
import { demoWorld, paymentDeps, serverLlm, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A request_payment can wait on PayPal for a hold and a capture (15 s timeout each) after resuming up to two of the
// caller's own stuck payments; give it the most a Vercel Hobby function allows.
export const maxDuration = 60;

const handle = withConfigCheck(async (request) => {
  const world = demoWorld();
  return handleMcpRequest(request, paymentDeps(), {
    resourceMetadata: (await endpoints()).resourceMetadata,
    shopping: { catalog: demoCatalog(world.shops, world.rogueMerchantId), llm: serverLlm },
  });
});

export { handle as GET, handle as POST, handle as DELETE };
