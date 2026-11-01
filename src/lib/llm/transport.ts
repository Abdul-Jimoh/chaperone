import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { canonicalJson, sha256Hex } from "@/lib/policy/canonical";

export type MessageParams = Anthropic.MessageCreateParamsNonStreaming;

/** Sends one Messages API request. Swapped for a replay in tests, so tests never reach the API. */
export type Transport = (params: MessageParams, purpose: string) => Promise<Anthropic.Message>;

type Fixture = { purpose: string; request: unknown; response: Anthropic.Message };

/** Functions (e.g. a Zod output format's parse helper) aren't part of the request on the wire. */
function wireForm(params: MessageParams): unknown {
  return JSON.parse(JSON.stringify(params));
}

export function fixtureKey(params: MessageParams): string {
  return sha256Hex(canonicalJson(wireForm(params))).slice(0, 16);
}

function fixturePath(dir: string, purpose: string, params: MessageParams) {
  return path.join(dir, `${purpose}-${fixtureKey(params)}.json`);
}

export function liveTransport(client: Anthropic): Transport {
  if (process.env.VITEST) throw new Error("Tests must not call the Anthropic API; use replayTransport.");
  return (params) => client.messages.create(params);
}

/** Calls the API and saves the exchange, so the same request can be replayed for free later. */
export function recordingTransport(client: Anthropic, dir: string): Transport {
  const live = liveTransport(client);
  return async (params, purpose) => {
    const response = await live(params, purpose);
    mkdirSync(dir, { recursive: true });
    const fixture: Fixture = { purpose, request: wireForm(params), response };
    writeFileSync(fixturePath(dir, purpose, params), `${JSON.stringify(fixture, null, 2)}\n`);
    return response;
  };
}

export class MissingFixtureError extends Error {}

export function replayTransport(dir: string): Transport {
  return async (params, purpose) => {
    const file = fixturePath(dir, purpose, params);
    if (!existsSync(file)) {
      throw new MissingFixtureError(
        `No recorded response at ${file}. The request changed, or it was never recorded (scripts/record-llm.ts).`,
      );
    }
    return (JSON.parse(readFileSync(file, "utf8")) as Fixture).response;
  };
}
