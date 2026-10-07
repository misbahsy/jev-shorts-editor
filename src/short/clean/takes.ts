/**
 * Take selection. An LLM reads the whole raw transcript (one line per phrase) and proposes word
 * ranges to drop: abandoned takes, restarts, stray slips. The code checks every proposal before
 * it is believed, so the model can only drop words that exist, can never drop the last take of a
 * line, and cannot remove more than a sane share of the speech. Jev's confirmed retakes stay;
 * the LLM adds the ones the n-gram pass missed. If the call fails nothing is added.
 */
import type { Word } from "../transcribe";
import { callGroq, extractJson, GROQ_TEXT_MODEL } from "../copy";
import { getGroqKey } from "../groqEnv";
import {
  RETAKE_WINDOW_WORDS,
  TAKES_MAX_DROP_FRACTION,
  TAKES_PHRASE_GAP_SEC,
  TAKES_SLIP_MAX_WORDS,
  TAKES_SLIP_WITH_TWIN_MAX_WORDS,
  TAKES_TWIN_OVERLAP,
} from "./constants";
import { buildTakesPrompt } from "./takesPrompt";
import { normWord } from "./retakes";

/** Sends the prompt, returns the model's text. Replaced in tests. */
export type TakesCall = (prompt: string) => Promise<string>;

export interface Phrase {
  /** First and last word index, inclusive. */
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface TakeDecision {
  from: number;
  to: number;
  /** Seconds of the first and last word of the range. */
  start: number;
  end: number;
  text: string;
  reason: string;
  accepted: boolean;
  /** Why a proposal was refused (absent when accepted). */
  rejected?: string;
}

export interface TakeSelection {
  mode: "llm" | "fallback" | "off";
  model?: string;
  latencyMs?: number;
  warning?: string;
  /** Word index to the reason it is dropped. */
  drops: Map<number, string>;
  decisions: TakeDecision[];
}

/** Splits the words into phrases at pauses of TAKES_PHRASE_GAP_SEC or more. */
export function packPhrases(words: Word[]): Phrase[] {
  const out: Phrase[] = [];
  let from = 0;
  for (let i = 1; i <= words.length; i++) {
    if (i === words.length || words[i].start - words[i - 1].end >= TAKES_PHRASE_GAP_SEC) {
      if (i > from) out.push({ from, to: i - 1, start: words[from].start, end: words[i - 1].end });
      from = i;
    }
  }
  return out;
}

/** The transcript the model sees: one line per phrase, times, and an index after every word. */
export function packTranscript(words: Word[], phrases: Phrase[] = packPhrases(words)): string {
  return phrases
    .map(p => `[${p.start.toFixed(1)}-${p.end.toFixed(1)}] ` + words.slice(p.from, p.to + 1).map(w => `${w.text}{${w.i}}`).join(" "))
    .join("\n");
}

interface Proposal {
  from: number;
  to: number;
  reason: string;
}

/** Reads the model's JSON. Anything malformed is dropped, never repaired. */
export function parseProposals(text: string): Proposal[] {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  let json: unknown;
  try {
    json = extractJson(cleaned);
  } catch {
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("take selection returned no JSON");
    json = JSON.parse(cleaned.slice(a, b + 1));
  }
  const list = (json as { drops?: unknown })?.drops;
  if (!Array.isArray(list)) throw new Error("take selection JSON has no drops array");
  const out: Proposal[] = [];
  for (const d of list) {
    const o = d as { from?: unknown; to?: unknown; reason?: unknown };
    out.push({ from: o.from as number, to: o.to as number, reason: typeof o.reason === "string" ? o.reason.slice(0, 200) : "" });
  }
  return out;
}

const STOP = new Set(["a", "an", "the", "is", "it", "of", "to", "in", "on", "and", "so", "for", "as", "be", "i", "you", "we", "that", "this", "now", "your", "or"]);

function contentTokens(words: Word[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    const n = normWord(words[i].text);
    if (n && !STOP.has(n)) out.push(n);
  }
  return out;
}

export interface GuardInput {
  words: Word[];
  proposals: Proposal[];
  /** Words Jev's confirmed retakes already remove. */
  alreadyRemoved: Set<number>;
}

/**
 * Checks each proposal. A proposal is refused when:
 *  - the indices are not whole words inside the transcript;
 *  - it is a longer drop (more than a slip) whose content is not said again later, which also
 *    means the last take of a line can never be dropped;
 *  - a short drop that stands inside a phrase has no later twin;
 *  - the words the model adds would pass TAKES_MAX_DROP_FRACTION of the speech.
 * Later drops are decided first, so a take is only judged against what survives after it.
 */
export function guardProposals(input: GuardInput): { decisions: TakeDecision[]; drops: Map<number, string> } {
  const { words, proposals, alreadyRemoved } = input;
  const phrases = packPhrases(words);
  const phraseOf = new Map<number, Phrase>();
  for (const p of phrases) for (let i = p.from; i <= p.to; i++) phraseOf.set(i, p);
  const lastWord = words.length - 1;
  const dur = (a: number, b: number) => { let s = 0; for (let i = a; i <= b; i++) s += words[i].end - words[i].start; return s; };
  const speech = dur(0, lastWord);

  const decisions: TakeDecision[] = [];
  const mk = (p: Proposal, accepted: boolean, rejected?: string): TakeDecision => {
    const ok = Number.isInteger(p.from) && Number.isInteger(p.to) && p.from >= 0 && p.to <= lastWord && p.from <= p.to;
    return {
      from: p.from, to: p.to,
      start: ok ? words[p.from].start : 0, end: ok ? words[p.to].end : 0,
      text: ok ? words.slice(p.from, p.to + 1).map(w => w.text).join(" ") : "",
      reason: p.reason, accepted, ...(rejected ? { rejected } : {}),
    };
  };

  const valid: Proposal[] = [];
  for (const p of proposals) {
    if (!Number.isInteger(p.from) || !Number.isInteger(p.to) || p.from < 0 || p.to > lastWord || p.from > p.to) decisions.push(mk(p, false, "indices are not words in the transcript"));
    else valid.push(p);
  }

  const removed = new Set(alreadyRemoved);
  const drops = new Map<number, string>();
  let removedSpeech = 0;
  const cap = speech * TAKES_MAX_DROP_FRACTION;

  // later drops first: each is judged against what survives after it
  valid.sort((a, b) => b.from - a.from);
  for (const p of valid) {
    let range: number[] = [];
    for (let i = p.from; i <= p.to; i++) if (!removed.has(i)) range.push(i);
    if (range.length === 0) { decisions.push(mk(p, false, "already removed")); continue; }
    const n = p.to - p.from + 1;
    const ph = phraseOf.get(p.from) as Phrase;
    const wholePhrase = p.from <= ph.from && p.to >= ph.to;
    // the twin: content said again after the range, in words that survive
    const mine = contentTokens(words, p.from, p.to);
    const after = new Set<string>();
    for (let i = p.to + 1; i <= Math.min(lastWord, p.to + RETAKE_WINDOW_WORDS); i++) if (!removed.has(i)) for (const t of contentTokens(words, i, i)) after.add(t);
    const shared = mine.filter(t => after.has(t)).length;
    const hasTwin = mine.length > 0 && shared / mine.length >= TAKES_TWIN_OVERLAP;
    let refuse: string | undefined;
    if (n <= TAKES_SLIP_MAX_WORDS) {
      if (!hasTwin && !(wholePhrase && p.to < lastWord)) refuse = "short drop inside a phrase with no repeat after it";
    } else if (n <= TAKES_SLIP_WITH_TWIN_MAX_WORDS) {
      if (!hasTwin) refuse = "not said again later";
    } else if (!hasTwin) {
      refuse = "not said again later, so it is the last take of its line";
    }
    if (!refuse) {
      const add = range.reduce((s, i) => s + words[i].end - words[i].start, 0);
      if (removedSpeech + add > cap) refuse = `would remove more than ${Math.round(TAKES_MAX_DROP_FRACTION * 100)}% of the speech`;
      else removedSpeech += add;
    }
    if (refuse) { decisions.push(mk(p, false, refuse)); continue; }
    for (const i of range) { removed.add(i); drops.set(i, p.reason); }
    decisions.push(mk(p, true));
  }
  decisions.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return { decisions, drops };
}

export interface SelectTakesInput {
  words: Word[];
  alreadyRemoved: Set<number>;
  call?: TakesCall;
  /** Skip the call entirely. */
  off?: boolean;
  log?: (m: string) => void;
}

export async function selectTakes(input: SelectTakesInput): Promise<TakeSelection> {
  const { words, alreadyRemoved } = input;
  const log = input.log ?? (() => {});
  const empty = (mode: TakeSelection["mode"], warning?: string): TakeSelection => ({ mode, drops: new Map(), decisions: [], ...(warning ? { warning } : {}) });
  if (words.length === 0 || input.off) return empty("off");
  const t0 = Date.now();
  try {
    const call: TakesCall = input.call ?? (prompt => callGroq(prompt, getGroqKey(), GROQ_TEXT_MODEL, 4096, undefined, 0));
    const text = await call(buildTakesPrompt(packTranscript(words)));
    const proposals = parseProposals(text);
    const { decisions, drops } = guardProposals({ words, proposals, alreadyRemoved });
    const latencyMs = Date.now() - t0;
    const refused = decisions.filter(d => !d.accepted).length;
    log(`clean: take selection (${GROQ_TEXT_MODEL}): ${proposals.length} proposed, ${decisions.length - refused} accepted, ${refused} refused, ${latencyMs} ms`);
    return { mode: "llm", model: GROQ_TEXT_MODEL, latencyMs, drops, decisions };
  } catch (err) {
    const warning = `take selection unavailable (${(err as Error).message.split("\n")[0]}); using the n-gram and Jev retakes only`;
    log(`clean: warning: ${warning}`);
    return empty("fallback", warning);
  }
}
