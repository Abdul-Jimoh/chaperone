import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParams, Transport } from "@/lib/llm/transport";

type Turn = { text?: string; tools?: { name: string; input: unknown }[] };

function message(content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return {
    id: "msg_scripted",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/**
 * Plays a fixed script for the shopping agent and answers classification with `classify`. Lets tests
 * stage what a model might do (including obeying an injected listing) without calling the API.
 */
export function scriptedTransport(agentTurns: Turn[], classify: (titles: Record<string, string>) => Record<string, string>) {
  const requests: { purpose: string; params: MessageParams }[] = [];
  let turn = 0;
  const transport: Transport = async (params, purpose) => {
    requests.push({ purpose, params });
    if (purpose === "classify") {
      const prompt = String(params.messages[0]!.content);
      const titles = Object.fromEntries([...prompt.matchAll(/^(L\d+): (.*) \[source category/gm)].map((m) => [m[1]!, m[2]!]));
      const products = Object.entries(classify(titles)).map(([id, category]) => ({ id, category }));
      return message([{ type: "text", text: JSON.stringify({ products }), citations: null }], "end_turn");
    }
    const step = agentTurns[turn++];
    if (!step) throw new Error("script ran out of turns");
    const content: Anthropic.ContentBlock[] = [];
    if (step.text) content.push({ type: "text", text: step.text, citations: null });
    for (const [i, t] of (step.tools ?? []).entries()) {
      content.push({ type: "tool_use", id: `toolu_${turn}_${i}`, name: t.name, input: t.input } as Anthropic.ToolUseBlock);
    }
    return message(content, step.tools?.length ? "tool_use" : "end_turn");
  };
  return { transport, requests };
}
