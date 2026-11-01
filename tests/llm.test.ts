import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { llmUsage } from "@/db/schema";
import { createLlm, LlmBudgetExceededError, LlmOutputError, LlmRefusalError } from "@/lib/llm/llm";
import { costMicroUsd, worstCaseMicroUsd } from "@/lib/llm/pricing";
import {
  fixtureKey,
  liveTransport,
  MissingFixtureError,
  replayTransport,
  type MessageParams,
  type Transport,
} from "@/lib/llm/transport";
import { resetDb, testDb } from "./support/db";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

function reply(text: string, usage = { input: 1000, output: 200 }, stop: string = "end_turn"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

const request = { max_tokens: 1000, messages: [{ role: "user" as const, content: "hello" }] };

describe("pricing", () => {
  it("prices Haiku 5.5 per token and switches rate card above 100K prompt tokens", () => {
    const usage = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(costMicroUsd("claude-haiku-5-5", usage(100_000, 0))).toBe(10_000);
    expect(costMicroUsd("claude-haiku-5-5", usage(0, 1_000_000))).toBe(500_000);
    expect(costMicroUsd("claude-haiku-5-5", usage(200_000, 0))).toBe(100_000);
    expect(costMicroUsd("claude-opus-5-5", usage(1_000_000, 0))).toBe(4_000_000);
  });

  it("never estimates below the real cost", () => {
    expect(worstCaseMicroUsd("claude-haiku-5-5", 400, 1000)).toBeGreaterThanOrEqual(
      costMicroUsd("claude-haiku-5-5", { input_tokens: 400, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    );
  });
});

describe("metered LLM wrapper", () => {
  it("defaults to Haiku with an explicit effort and records the real cost", async () => {
    const transport = vi.fn<Transport>(async () => reply("hi"));
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    await llm.message("classify", request);

    const sent = transport.mock.calls[0]![0];
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.output_config?.effort).toBe("low");

    const rows = await db.select().from(llmUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "settled", inputTokens: 1000, outputTokens: 200, costMicroUsd: 200 });
  });

  it("refuses a call that could push spend past the cap, without calling the API", async () => {
    await db.insert(llmUsage).values({ purpose: "classify", model: "claude-haiku-5-5", status: "settled", costMicroUsd: 1_499_900 });
    const transport = vi.fn<Transport>(async () => reply("hi"));
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    await expect(llm.message("classify", request)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("can't be overspent by concurrent calls", async () => {
    const committed: number[] = [];
    const llm = createLlm({
      db,
      budgetUsd: 0.02,
      transport: async () => {
        committed.push(await llm.spentMicroUsd());
        await new Promise((r) => setTimeout(r, 30));
        return reply("hi", { input: 10, output: 10 });
      },
    });
    // Each call reserves its worst case (~0.5 cents), so a 2-cent cap admits only a few at a time.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => llm.message("shopping_agent", { ...request, max_tokens: 10_000 })),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((r) => r.reason instanceof LlmBudgetExceededError)).toBe(true);
    expect(Math.max(...committed)).toBeLessThanOrEqual(llm.capMicroUsd);
    expect(await llm.spentMicroUsd()).toBeLessThanOrEqual(llm.capMicroUsd);
  });

  it("returns the reservation when the request fails", async () => {
    const llm = createLlm({ db, transport: async () => Promise.reject(new Error("network")), budgetUsd: 1.5 });
    await expect(llm.message("classify", request)).rejects.toThrow("network");
    expect(await llm.spentMicroUsd()).toBe(0);
    const [row] = await db.select().from(llmUsage);
    expect(row?.status).toBe("failed");
  });

  it("keeps Opus behind an explicit approval", async () => {
    const transport = vi.fn<Transport>(async () => reply("hi"));
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    await expect(llm.message("compile_mandate", { ...request, model: "claude-opus-5-5" })).rejects.toThrow("approval");
    expect(transport).not.toHaveBeenCalled();
  });

  it("raises on a refusal but still meters it", async () => {
    const llm = createLlm({ db, transport: async () => reply("", { input: 50, output: 0 }, "refusal"), budgetUsd: 1.5 });
    await expect(llm.message("classify", request)).rejects.toBeInstanceOf(LlmRefusalError);
    const [row] = await db.select().from(llmUsage);
    expect(row?.status).toBe("settled");
  });
});

describe("structured output", () => {
  const schema = z.object({ category: z.enum(["coffee", "pet_food"]) });

  it("sends the JSON schema and returns validated data", async () => {
    const transport = vi.fn<Transport>(async () => reply('{"category":"coffee"}'));
    const llm = createLlm({ db, transport, budgetUsd: 1.5 });
    const { data } = await llm.structured("classify", schema, request);
    expect(data).toEqual({ category: "coffee" });
    expect(transport.mock.calls[0]![0].output_config?.format?.type).toBe("json_schema");
  });

  it("rejects output that doesn't match the schema", async () => {
    const llm = createLlm({ db, transport: async () => reply('{"category":"jewellery"}'), budgetUsd: 1.5 });
    await expect(llm.structured("classify", schema, request)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("rejects truncated output", async () => {
    const llm = createLlm({ db, transport: async () => reply('{"categ', undefined, "max_tokens"), budgetUsd: 1.5 });
    await expect(llm.structured("classify", schema, request)).rejects.toBeInstanceOf(LlmOutputError);
  });
});

describe("transports", () => {
  it("refuses to build a live transport under test", () => {
    expect(() => liveTransport({} as Anthropic)).toThrow("must not call");
  });

  it("replays a recorded response for an identical request, whatever the key order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "llm-fixtures-"));
    const params: MessageParams = { model: "claude-haiku-5-5", ...request };
    writeFileSync(
      path.join(dir, `classify-${fixtureKey(params)}.json`),
      JSON.stringify({ purpose: "classify", request: params, response: reply("recorded") }),
    );
    const replay = replayTransport(dir);
    const reordered: MessageParams = { messages: request.messages, max_tokens: 1000, model: "claude-haiku-5-5" };
    const response = await replay(reordered, "classify");
    expect(response.content[0]).toMatchObject({ text: "recorded" });
    await expect(replay({ ...params, max_tokens: 5 }, "classify")).rejects.toBeInstanceOf(MissingFixtureError);
  });
});
