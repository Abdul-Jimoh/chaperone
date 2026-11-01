import { handleMcpRequest } from "@/mcp/http";
import { paymentDeps } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (request: Request) => handleMcpRequest(request, paymentDeps());

export { handle as GET, handle as POST, handle as DELETE };
