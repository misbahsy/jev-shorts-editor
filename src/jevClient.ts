/**
 * Plain-fetch client for Jev decision requests. Talks either to TypeSafe's API
 * directly (POST /v1/systemone) or to a LiteLLM gateway's POST /v1/decisions,
 * which takes the same { model, state, questions } body and returns the same
 * answers. Field names verified against https://docs.typesafe.ai/api.md and
 * LiteLLM's litellm/types/decisions.py.
 */

import type { JevTarget } from "./env";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: (string | { what: string; examples?: string[] })[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer { type: "noul"; noul: number }
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  // LiteLLM's /v1/decisions may return usage: null.
  usage: { input_tokens: number; output_tokens: number } | null;
}

export class JevHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, hint = "") {
    super(`Jev HTTP ${status}${hint ? `: ${hint}` : ""}`);
    this.status = status;
    this.body = body;
  }
}

export interface CallResult {
  response: SystemOneResponse;
  latencyMs: number;
  retries: number;
}

const RETRYABLE_STATUS = new Set([429, 529]);
const MAX_TRIES = 4;
const TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Explains the one gateway failure that is not obvious from the status code. */
function gatewayHint(target: JevTarget, status: number, body: string): string {
  if (target.via !== "litellm" || status !== 400) return "";
  if (/\binput\b/.test(body)) {
    return "this LiteLLM gateway expects the newer OpenAI-style Decisions body (input, questions array), which this client does not send yet";
  }
  if (/model/i.test(body)) {
    return `check that the gateway has a model group named "${target.model}" (set JEV_MODEL to change it)`;
  }
  return "";
}

/**
 * POST { state, model, questions } to the target. Retries up to
 * MAX_TRIES total attempts with exponential backoff (+ jitter) on 429/529
 * and on network/timeout errors. Per-request timeout is 30s (aborted via
 * AbortController; counts as a retryable failure, not a hang).
 */
export async function callSystemOne(
  target: JevTarget,
  state: unknown,
  questions: Record<string, Question>,
): Promise<CallResult> {
  let attempt = 0;
  let lastErr: unknown;
  const overallStart = Date.now();
  while (attempt < MAX_TRIES) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const reqStart = Date.now();
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: target.model, questions }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_TRIES) {
          const backoff = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 250;
          await sleep(backoff);
          lastErr = new JevHttpError(res.status, text.slice(0, 2000));
          continue;
        }
        throw new JevHttpError(res.status, text.slice(0, 2000), gatewayHint(target, res.status, text));
      }
      const parsed = JSON.parse(text) as SystemOneResponse;
      return {
        response: parsed,
        latencyMs: Date.now() - reqStart,
        retries: attempt - 1,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof JevHttpError) throw err;
      // network error, abort/timeout, or JSON parse failure — retry if we can
      lastErr = err;
      if (attempt < MAX_TRIES) {
        const backoff = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 250;
        await sleep(backoff);
        continue;
      }
    }
  }
  const totalMs = Date.now() - overallStart;
  throw new Error(
    `Jev request failed after ${attempt} attempts over ${totalMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
