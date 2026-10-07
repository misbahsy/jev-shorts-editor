/**
 * Asks Jev which retake candidates are real. One noul question per candidate, up to JEV_BATCH
 * per request, a few requests in flight at once. If Jev is unreachable the strongest
 * deterministic candidates are cut instead and the mode is reported as "fallback".
 */
import type { Word } from "../transcribe";
import { getJevTarget } from "../../env";
import { callSystemOne, type CallResult, type Question } from "../../jevClient";
import { FALLBACK_MIN_MATCH, JEV_BATCH, JEV_CHAIN_THRESHOLD, JEV_CONCURRENCY, JEV_CUT_THRESHOLD } from "./constants";
import { chainCandidates, describeCandidate, type RetakeCandidate } from "./retakes";

export interface Confirmed {
  cand: RetakeCandidate;
  /** Jev's probability, absent in fallback mode. */
  jev?: number;
}

export interface ConfirmResult {
  accepted: Confirmed[];
  /** Every candidate with the score Jev gave it (empty in fallback mode). */
  scored: Confirmed[];
  mode: "jev" | "fallback" | "none";
  calls: number;
  latencyMs: number[];
  warning?: string;
}

export type JevCall = (state: unknown, questions: Record<string, Question>) => Promise<CallResult>;

const INSTRUCTIONS =
  "A speaker recorded a take, stopped, and said it again. The words in [REMOVED] are proposed for deletion. " +
  "Answer true if the speaker says the same thing again right after (in AFTER), so the removed words were an abandoned or repeated take, " +
  "and JOINED reads as one clean sentence without them. The redo may be reworded, and the removed part may be several takes in a row: only the last take stays. " +
  "Answer false if the repetition is deliberate (emphasis, a list, a refrain, a callback), " +
  "or if the removed words carry an idea that is not said again, or JOINED reads broken.";

const CRITERIA = {
  true: "AFTER says the removed words again (or says them better), and JOINED reads cleanly.",
  false: "The removed words are not redone afterwards, or the repetition is on purpose, or JOINED is broken.",
};

function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker())).then(() => results);
}

export function fallbackAccept(cands: RetakeCandidate[]): Confirmed[] {
  return cands
    .filter(c => c.strength >= FALLBACK_MIN_MATCH || (c.kind === "stutter" && c.strength >= 3))
    .map(cand => ({ cand }));
}

function questionFor(words: Word[], c: RetakeCandidate): Question {
  const clip = describeCandidate(words, c);
  return {
    type: "noul",
    instructions:
      `${INSTRUCTIONS}\n\nBEFORE: ${clip.before}\n[REMOVED: ${clip.removed}]\nAFTER: ${clip.after}\n\nJOINED: ${clip.result}`,
    criteria: CRITERIA,
  };
}

export async function confirmRetakes(
  words: Word[],
  cands: RetakeCandidate[],
  call?: JevCall,
  log: (m: string) => void = m => console.error(m),
): Promise<ConfirmResult> {
  if (cands.length === 0) return { accepted: [], scored: [], mode: "none", calls: 0, latencyMs: [] };
  let ask = call;
  if (!ask) {
    try {
      const target = getJevTarget();
      ask = (state, questions) => callSystemOne(target, state, questions);
    } catch (err) {
      const warning = `Jev unavailable (${(err as Error).message.split("\n")[0]}); cutting only strong retake matches`;
      log(`clean: warning: ${warning}`);
      return { accepted: fallbackAccept(cands), scored: [], mode: "fallback", calls: 0, latencyMs: [], warning };
    }
  }
  // A chain of takes is asked about as a whole, and (when it has several links) link by link
  // too; the whole wins if Jev says yes, otherwise the links that pass on their own are cut.
  const chains = chainCandidates(cands);
  const asked: RetakeCandidate[] = [];
  for (const ch of chains) {
    if (ch.members.length > 1) asked.push(ch.merged);
    asked.push(...ch.members);
  }
  const state = {
    task: "Review proposed deletions of abandoned takes in a raw talking-head transcript.",
    transcript: words.map(w => w.text).join(" "),
  };
  const batches: RetakeCandidate[][] = [];
  for (let i = 0; i < asked.length; i += JEV_BATCH) batches.push(asked.slice(i, i + JEV_BATCH));
  const latencyMs: number[] = [];
  try {
    const results = await mapLimit(batches, JEV_CONCURRENCY, async batch => {
      const questions: Record<string, Question> = {};
      batch.forEach((c, k) => {
        questions[`c${k}`] = questionFor(words, c);
      });
      const res = await (ask as JevCall)(state, questions);
      latencyMs.push(res.latencyMs);
      return batch.map((cand, k): Confirmed => {
        const a = res.response.answers[`c${k}`];
        if (!a || a.type !== "noul") throw new Error(`Jev gave no noul answer for candidate ${k}`);
        return { cand, jev: a.noul };
      });
    });
    const scored = results.flat();
    const score = new Map<RetakeCandidate, number>();
    for (const r of scored) score.set(r.cand, r.jev ?? 0);
    const accepted: Confirmed[] = [];
    for (const ch of chains) {
      const whole = ch.members.length > 1 ? score.get(ch.merged) ?? 0 : 0;
      if (ch.members.length > 1 && whole >= JEV_CHAIN_THRESHOLD) {
        accepted.push({ cand: ch.merged, jev: whole });
        continue;
      }
      for (const m of ch.members) {
        const j = score.get(m) ?? 0;
        if (j >= JEV_CUT_THRESHOLD) accepted.push({ cand: m, jev: j });
      }
    }
    return { accepted, scored, mode: "jev", calls: batches.length, latencyMs };
  } catch (err) {
    const warning = `Jev call failed (${(err as Error).message.split("\n")[0]}); cutting only strong retake matches`;
    log(`clean: warning: ${warning}`);
    return { accepted: fallbackAccept(cands), scored: [], mode: "fallback", calls: batches.length, latencyMs, warning };
  }
}
