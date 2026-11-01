import { handleMcpRequest } from "@/mcp/http";
import { paymentDeps, withConfigCheck } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = withConfigCheck((request) => handleMcpRequest(request, paymentDeps()));

export { handle as GET, handle as POST, handle as DELETE };
