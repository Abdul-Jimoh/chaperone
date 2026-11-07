import { NotYoursError, runDemoAgent } from "@/lib/app/demo";
import { sessionUserId } from "@/lib/app/session";
import { ConfigError } from "@/lib/env";
import { LlmBudgetExceededError } from "@/lib/llm/llm";
import { RateLimitedError } from "@/lib/ratelimit";
import { demoSearch, demoWorld, paymentDeps, serverLlm } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function explain(error: unknown): string {
  if (error instanceof RateLimitedError || error instanceof NotYoursError) return error.message;
  if (error instanceof LlmBudgetExceededError) return "The demo has used its Claude budget for new shopping trips. The example trip still works.";
  if (error instanceof ConfigError) return "Claude isn't set up on this server.";
  console.error("agent run failed:", error);
  return "The agent stopped unexpectedly. Anything it already bought is listed under Activity.";
}

/** Streams the agent's steps as newline-delimited JSON, so the page can show each search and payment as it happens. */
export async function POST(request: Request): Promise<Response> {
  // A cookie-authenticated POST: refuse other sites' pages, as Next does for server actions.
  const origin = request.headers.get("origin");
  if (origin && URL.parse(origin)?.host !== request.headers.get("host")) return new Response("Forbidden", { status: 403 });
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Start the demo first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { goal?: unknown; attempt?: unknown } | null;
  if (typeof body?.goal !== "string" || typeof body.attempt !== "string" || !UUID.test(body.attempt)) {
    return Response.json({ error: "Send a goal and an attempt id." }, { status: 400 });
  }
  const { goal, attempt } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const run = await runDemoAgent({ payments: paymentDeps(), llm: serverLlm(userId), search: demoSearch(), world: demoWorld() }, userId, {
          goal,
          attemptId: attempt,
          onStep: (step) => send({ type: "step", step }),
        });
        send({ type: "done", summary: run.summary, stopped: run.stopped });
      } catch (error) {
        send({ type: "error", message: explain(error) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
