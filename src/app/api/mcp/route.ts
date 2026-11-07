import { endpoints } from "@/lib/oauth-http";
import { handleMcpRequest } from "@/mcp/http";
import { demoCatalog } from "@/lib/catalog";
import { demoWorld, paymentDeps, serverLlm, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = withConfigCheck(async (request) => {
  const world = demoWorld();
  return handleMcpRequest(request, paymentDeps(), {
    resourceMetadata: (await endpoints()).resourceMetadata,
    shopping: { catalog: demoCatalog(world.shops, world.rogueMerchantId), llm: serverLlm },
  });
});

export { handle as GET, handle as POST, handle as DELETE };
