/**
 * Retake candidates: stretches of the transcript where the speaker said something, stopped, and
 * said it again. The earlier stretch is the abandoned take; the later one stays. Everything here
 * is a pure function of the word list. Jev decides which candidates are real (confirm.ts).
 *
 * A candidate is a half-open word-index span [start, end): cut those words, keep the rest.
 */
import type { Word } from "../transcribe";
import { RETAKE_WINDOW_SEC, RETAKE_WINDOW_WORDS, TAKE_BOUNDARY_GAP_SEC } from "./constants";

export interface RetakeCandidate {
  /** First word to remove. */
  start: number;
  /** One past the last word to remove: this is where the final take begins. */
  end: number;
  /** How many words the two takes share. */
  strength: number;
  kind: "ngram" | "sentence" | "stutter";
}

const CONTRACTIONS: Record<string, string> = {
  theres: "there", thats: "that", whats: "what", heres: "here", lets: "let", youre: "you", theyre: "they", im: "i",
};

const STOP = new Set([
  "a", "an", "the", "is", "it", "its", "of", "to", "in", "on", "at", "or", "and", "so", "but", "for", "with", "as",
  "be", "was", "were", "are", "this", "that", "these", "those", "i", "you", "we", "they", "he", "she", "if", "then",
  "than", "just", "can", "could", "will", "would", "should", "do", "does", "did", "not", "no", "yes", "up", "out",
  "now", "there", "here", "your", "my", "our", "by", "from", "have", "has", "had", "what", "when", "how",
]);

export function normWord(text: string): string {
  const n = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return CONTRACTIONS[n] ?? n;
}

export function endsSentence(text: string): boolean {
  return /[.!?]["')\]]?$/.test(text);
}

function isContent(n: string): boolean {
  return n.length >= 3 && !STOP.has(n);
}

interface Run {
  /** Words that lined up, counting the one allowed substitution/insertion as not matched. */
  matched: number;
  /** Words of the earlier take the run covers. */
  lenI: number;
  lenJ: number;
}

/**
 * Walks both takes forward from (i, j), which must start on equal words. One substituted word,
 * or one word inserted or dropped on either side, is forgiven; a second mismatch ends the run.
 * The earlier take is never allowed to run into the start of the later one.
 */
function alignRun(norm: string[], i: number, j: number): Run {
  const n = norm.length;
  const startI = i;
  const startJ = j;
  let matched = 0;
  let errors = 0;
  while (i < j && j < n) {
    if (norm[i] === norm[j] && norm[i] !== "") {
      matched++;
      i++;
      j++;
      continue;
    }
    if (errors >= 1) break;
    // substitution: the words differ but the ones after them line up
    if (i + 1 < j && j + 1 < n && norm[i + 1] === norm[j + 1] && norm[i + 1] !== "") {
      errors++;
      i++;
      j++;
    } else if (i + 1 < j && norm[i + 1] === norm[j]) {
      // the earlier take has an extra word
      errors++;
      i++;
    } else if (j + 1 < n && norm[i] === norm[j + 1]) {
      // the later take has an extra word
      errors++;
      j++;
    } else {
      break;
    }
  }
  return { matched, lenI: i - startI, lenJ: j - startJ };
}

/**
 * Where the final take really begins. The matched run may start in the middle of the later take
 * (it opened with a new lead-in word or two), so look back from `j` for a sentence start, or a
 * pause, between the end of the earlier run and `j`. Never earlier than `floor`.
 */
function snapTakeStart(words: Word[], j: number, floor: number): number {
  let bestSentence = -1;
  let bestGap = -1;
  let bestGapSize = 0.25;
  for (let b = j; b > floor; b--) {
    if (b > 0 && endsSentence(words[b - 1].text)) {
      bestSentence = b;
      break;
    }
    const gap = words[b].start - words[b - 1].end;
    if (gap >= bestGapSize && bestGap < 0) {
      bestGap = b;
      bestGapSize = gap;
    }
  }
  if (bestSentence > floor) return bestSentence;
  if (bestGap > floor) return bestGap;
  return j;
}

interface Sentence {
  start: number;
  end: number;
}

export function splitSentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let s = 0;
  for (let i = 0; i < words.length; i++) {
    if (endsSentence(words[i].text) || i === words.length - 1) {
      out.push({ start: s, end: i + 1 });
      s = i + 1;
    }
  }
  return out;
}

/** True when word i opens a sentence or a comma clause. */
function opensClause(words: Word[], i: number): boolean {
  return i === 0 || endsSentence(words[i - 1].text) || /,["')\]]?$/.test(words[i - 1].text);
}

/**
 * Repeated runs of 3+ words (one slip allowed) within the retake window. A run is tried from its
 * first word, and again from every sentence or clause start inside it, because a long repeated
 * stretch can hide a retake of one sentence in the middle (the earlier take of "X. Y." is
 * followed by "Y" with a new lead-in).
 */
function ngramCandidates(words: Word[], norm: string[]): RetakeCandidate[] {
  type Raw = RetakeCandidate & { lenI: number; diag: number; boundary: boolean };
  const raw: Raw[] = [];
  const n = words.length;
  for (let i = 0; i < n; i++) {
    if (!norm[i]) continue;
    const trueStart = (j: number) => !(i > 0 && j > 0 && norm[i - 1] === norm[j - 1] && norm[i - 1] !== "");
    const boundary = opensClause(words, i);
    for (let j = i + 3; j < n && j - i <= RETAKE_WINDOW_WORDS; j++) {
      if (words[j].start - words[i].start > RETAKE_WINDOW_SEC) break;
      if (norm[i] !== norm[j]) continue;
      if (!trueStart(j) && !boundary) continue;
      const run = alignRun(norm, i, j);
      if (run.matched < 3) continue;
      let hasContent = run.matched >= 4;
      for (let k = 0; k < run.lenI && !hasContent; k++) if (isContent(norm[i + k])) hasContent = true;
      if (!hasContent) continue;
      const end = snapTakeStart(words, j, i + run.lenI - 1);
      if (end <= i) continue;
      raw.push({ start: i, end, strength: run.matched, kind: "ngram", lenI: run.lenI, diag: j - i, boundary: boundary && !trueStart(j) });
      break; // nearest repeat only: a triple take is two candidates, not three
    }
  }
  // a run that begins inside a longer one on nearly the same diagonal is the same repeat,
  // unless it begins at a sentence or clause start (see above)
  raw.sort((a, b) => a.start - b.start || b.strength - a.strength);
  const kept: Raw[] = [];
  for (const c of raw) {
    const dup = kept.some(
      k => (k.start === c.start && k.end === c.end) ||
        (!c.boundary && c.start >= k.start && c.start < k.start + k.lenI && Math.abs(c.diag - k.diag) <= 2),
    );
    if (!dup) kept.push(c);
  }
  return kept.map(({ start, end, strength, kind }) => ({ start, end, strength, kind }));
}

/** Adjacent sentences that open the same way and mostly say the same thing. */
function sentenceCandidates(words: Word[], norm: string[]): RetakeCandidate[] {
  const sents = splitSentences(words);
  const out: RetakeCandidate[] = [];
  for (let k = 0; k + 1 < sents.length; k++) {
    const a = sents[k];
    const b = sents[k + 1];
    if (norm[a.start] === "" || norm[a.start] !== norm[b.start]) continue;
    const sameTwo = a.end - a.start >= 2 && b.end - b.start >= 2 && norm[a.start + 1] === norm[b.start + 1];
    const contentA = new Set<string>();
    const contentB = new Set<string>();
    for (let i = a.start; i < a.end; i++) if (isContent(norm[i])) contentA.add(norm[i]);
    for (let i = b.start; i < b.end; i++) if (isContent(norm[i])) contentB.add(norm[i]);
    const minSize = Math.min(contentA.size, contentB.size);
    if (minSize === 0) continue;
    let shared = 0;
    for (const w of contentA) if (contentB.has(w)) shared++;
    if (shared / minSize < 0.5) continue;
    if (!sameTwo && minSize < 2) continue;
    out.push({ start: a.start, end: b.start, strength: shared + (sameTwo ? 2 : 1), kind: "sentence" });
  }
  return out;
}

export function findRetakeCandidates(words: Word[]): RetakeCandidate[] {
  const norm = words.map(w => normWord(w.text));
  const all: RetakeCandidate[] = ngramCandidates(words, norm);
  for (const s of sentenceCandidates(words, norm)) {
    const dup = all.find(c => c.start === s.start && c.end === s.end);
    if (dup) dup.strength = Math.max(dup.strength, s.strength);
    else all.push(s);
  }
  all.sort((a, b) => a.start - b.start || a.end - b.end);
  const out = pruneCandidates(words, all);
  for (const st of stutterCandidates(words, norm)) {
    if (!out.some(c => c.start === st.start && c.end === st.end)) out.push(st);
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * A short phrase said twice in a row ("and work for and work for"). The first copy is the
 * stutter, the second stays. Longest phrase wins; one-word repeats are left alone because
 * "very, very" and "no no no" are usually deliberate.
 */
export function stutterCandidates(words: Word[], norm: string[]): RetakeCandidate[] {
  const out: RetakeCandidate[] = [];
  let i = 0;
  while (i < words.length) {
    let hit = 0;
    for (let len = 4; len >= 2 && !hit; len--) {
      if (i + 2 * len > words.length) continue;
      let same = true;
      for (let k = 0; k < len && same; k++) same = norm[i + k] !== "" && norm[i + k] === norm[i + len + k];
      if (!same) continue;
      let content = len >= 3;
      for (let k = 0; k < len && !content; k++) if (isContent(norm[i + k])) content = true;
      // a sentence break inside the first copy means two separate sentences, not a stutter
      let broken = false;
      for (let k = 0; k < len - 1; k++) if (endsSentence(words[i + k].text)) broken = true;
      if (content && !broken) hit = len;
    }
    if (hit) {
      out.push({ start: i, end: i + hit, strength: hit, kind: "stutter" });
      i += hit;
    } else i++;
  }
  return out;
}

/**
 * Drop candidates that cannot be a whole abandoned take: ones that start mid-clause with no pause
 * before them, and merged spans that just contain two or more other candidates (the finer ones
 * are asked about individually and later unioned).
 */
export function pruneCandidates(words: Word[], cands: RetakeCandidate[]): RetakeCandidate[] {
  const atBoundary = (i: number) =>
    opensClause(words, i) || words[i].start - words[i - 1].end >= TAKE_BOUNDARY_GAP_SEC;
  const starts = cands.filter(c => atBoundary(c.start));
  return starts.filter(c => {
    const inside = starts.filter(o => o !== c && o.start >= c.start && o.end <= c.end).length;
    return inside < 2;
  });
}

/**
 * Candidates that overlap or abut form a chain (a triple take is two candidates side by side).
 * Each chain with more than one member becomes one merged candidate, because removing a single
 * link leaves a broken sentence and only the whole chain reads cleanly.
 */
export function chainCandidates(cands: RetakeCandidate[]): { merged: RetakeCandidate; members: RetakeCandidate[] }[] {
  const sorted = [...cands].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { merged: RetakeCandidate; members: RetakeCandidate[] }[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start <= last.merged.end) {
      last.members.push(c);
      last.merged.end = Math.max(last.merged.end, c.end);
      last.merged.strength = Math.max(last.merged.strength, c.strength);
    } else {
      out.push({ merged: { ...c }, members: [c] });
    }
  }
  return out;
}

/** The union of spans, as sorted non-overlapping [start, end) word ranges. */
export function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = spans.map(s => ({ ...s })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push(s);
  }
  return out;
}

const CONTEXT_WORDS = 24;

export interface RetakeClip {
  before: string;
  removed: string;
  after: string;
  /** The sentence as it reads once the span is gone. */
  result: string;
}

const join = (ws: Word[]) => ws.map(w => w.text).join(" ").replace(/\s+/g, " ").trim();

/** The text Jev is shown for one candidate. */
export function describeCandidate(words: Word[], c: { start: number; end: number }): RetakeClip {
  const before = words.slice(Math.max(0, c.start - CONTEXT_WORDS), c.start);
  const after = words.slice(c.end, c.end + CONTEXT_WORDS);
  let s = c.start;
  while (s > 0 && c.start - s < 40 && !endsSentence(words[s - 1].text)) s--;
  let e = c.end;
  while (e < words.length && e - c.end < 40) {
    const hit = endsSentence(words[e].text);
    e++;
    if (hit) break;
  }
  return {
    before: join(before),
    removed: join(words.slice(c.start, c.end)),
    after: join(after),
    result: join([...words.slice(s, c.start), ...words.slice(c.end, e)]),
  };
}
