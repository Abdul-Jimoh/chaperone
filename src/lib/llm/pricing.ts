import type Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const EXPENSIVE_MODEL = "claude-opus-5-5";
export type Model = typeof DEFAULT_MODEL | typeof EXPENSIVE_MODEL;

/** USD per million tokens, from the Anthropic price list. Cache writes are the 5-minute rate. */
type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<Model, { standard: Rates; longPrompt?: { aboveTokens: number; rates: Rates } }> = {
  "claude-haiku-5-5": {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    longPrompt: { aboveTokens: 100_000, rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  "claude-opus-5-5": {
    standard: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
};

export function isKnownModel(model: string): model is Model {
  return model in PRICES;
}

type Usage = Pick<
  Anthropic.Usage,
  "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens"
>;

/** Cost of one response in micro-USD, rounded up so the meter never under-counts. */
export function costMicroUsd(model: Model, usage: Usage): number {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
  const price = PRICES[model];
  const rates =
    price.longPrompt && promptTokens > price.longPrompt.aboveTokens ? price.longPrompt.rates : price.standard;
  return Math.ceil(
    usage.input_tokens * rates.input +
      usage.output_tokens * rates.output +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite,
  );
}

/**
 * Upper bound for a request before it is sent: every prompt character counted as a token (real
 * tokenisation is several characters per token) and the full max_tokens of output.
 */
export function worstCaseMicroUsd(model: Model, promptChars: number, maxTokens: number): number {
  return costMicroUsd(model, { input_tokens: promptChars, output_tokens: maxTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
}
