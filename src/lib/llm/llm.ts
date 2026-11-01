import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { llmUsage } from "@/db/schema";
import { costMicroUsd, DEFAULT_MODEL, isKnownModel, worstCaseMicroUsd, type Model } from "./pricing";
import type { MessageParams, Transport } from "./transport";

/** Claude's three jobs in Chaperone. None of them decides a payment. */
export type LlmPurpose = "compile_mandate" | "shopping_agent" | "classify";

export type LlmOptions = {
  db: Db;
  transport: Transport;
  budgetUsd: number;
  sessionId?: string | null;
  /** Opus is only for a run the human has approved; everything else runs on Haiku. */
  allowExpensiveModel?: boolean;
};

export type LlmRequest = Omit<MessageParams, "model"> & { model?: Model };
export type Effort = NonNullable<NonNullable<MessageParams["output_config"]>["effort"]>;

export class LlmBudgetExceededError extends Error {
  constructor(
    readonly spentMicroUsd: number,
    readonly requestMicroUsd: number,
    readonly capMicroUsd: number,
  ) {
    super(
      `LLM budget reached: $${(spentMicroUsd / 1e6).toFixed(4)} spent of $${(capMicroUsd / 1e6).toFixed(2)}; ` +
        `this call could cost up to $${(requestMicroUsd / 1e6).toFixed(4)}.`,
    );
  }
}

export class LlmRefusalError extends Error {}
export class LlmOutputError extends Error {}

// Arbitrary constant; serialises budget checks across every process sharing the database.
const BUDGET_LOCK_KEY = 0x4c4c4d;

export type Llm = ReturnType<typeof createLlm>;

export function createLlm(options: LlmOptions) {
  const capMicroUsd = Math.round(options.budgetUsd * 1_000_000);

  async function spentMicroUsd(): Promise<number> {
    const [row] = await options.db
      .select({ total: sql<string>`coalesce(sum(${llmUsage.costMicroUsd}), 0)` })
      .from(llmUsage);
    return Number(row?.total ?? 0);
  }

  async function reserve(purpose: LlmPurpose, model: Model, estimate: number): Promise<string> {
    return options.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${BUDGET_LOCK_KEY})`);
      const [row] = await tx
        .select({ total: sql<string>`coalesce(sum(${llmUsage.costMicroUsd}), 0)` })
        .from(llmUsage);
      const spent = Number(row?.total ?? 0);
      if (spent + estimate > capMicroUsd) throw new LlmBudgetExceededError(spent, estimate, capMicroUsd);
      const [reserved] = await tx
        .insert(llmUsage)
        .values({ purpose, model, costMicroUsd: estimate, sessionId: options.sessionId ?? null })
        .returning({ id: llmUsage.id });
      return reserved!.id;
    });
  }

  async function message(purpose: LlmPurpose, request: LlmRequest): Promise<Anthropic.Message> {
    const model = request.model ?? DEFAULT_MODEL;
    if (!isKnownModel(model)) throw new Error(`Model ${model} has no price entry`);
    if (model !== DEFAULT_MODEL && !options.allowExpensiveModel) {
      throw new Error(`${model} needs explicit approval (allowExpensiveModel)`);
    }
    const params: MessageParams = {
      ...request,
      model,
      output_config: { effort: "low", ...request.output_config },
    };

    const promptChars = JSON.stringify([params.system, params.messages, params.tools, params.output_config]).length;
    const id = await reserve(purpose, model, worstCaseMicroUsd(model, promptChars, params.max_tokens));

    let response: Anthropic.Message;
    try {
      response = await options.transport(params, purpose);
    } catch (error) {
      // Failed requests aren't billed, so the reservation is returned.
      await options.db.update(llmUsage).set({ status: "failed", costMicroUsd: 0 }).where(eq(llmUsage.id, id));
      throw error;
    }

    const { usage } = response;
    await options.db
      .update(llmUsage)
      .set({
        status: "settled",
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        costMicroUsd: costMicroUsd(model, usage),
      })
      .where(eq(llmUsage.id, id));

    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError(`Claude declined the request (${response.stop_details?.category ?? "no category"})`);
    }
    return response;
  }

  /** A JSON answer constrained by the schema on the API side and validated again here. */
  async function structured<S extends z.ZodType>(
    purpose: LlmPurpose,
    schema: S,
    request: Omit<LlmRequest, "output_config"> & { effort?: Effort },
  ): Promise<{ data: z.infer<S>; message: Anthropic.Message }> {
    const { effort, ...rest } = request;
    const response = await message(purpose, {
      ...rest,
      output_config: { effort: effort ?? "low", format: zodOutputFormat(schema) },
    });
    if (response.stop_reason === "max_tokens") throw new LlmOutputError("Response was cut off at max_tokens");
    const text = response.content.find((b) => b.type === "text")?.text;
    if (text === undefined) throw new LlmOutputError("Response had no text block");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmOutputError("Response was not valid JSON");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new LlmOutputError(`Response failed validation: ${parsed.error.message}`);
    return { data: parsed.data, message: response };
  }

  return { message, structured, spentMicroUsd, capMicroUsd };
}
