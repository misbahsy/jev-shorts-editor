/**
 * Shot splitting: the unit every per-shot decision (camera, overlay, text effect, transition,
 * sfx) is made on. A shot is a run of whole words lasting about 2 to 3 seconds, cut where the
 * speaker naturally pauses: sentence ends first, then commas, then clause words ("and", "but",
 * "because"), then a plain phrase break. A shot never ends on a word that needs the next one
 * ("the", "to", "of", ...), and never cuts a word in half.
 *
 * Short-form video wants something new on screen every 2 to 3 seconds, and sentence-sized beats
 * (up to 8 s) cannot give that. Pure and deterministic, so plan.ts and decide.ts agree on the list.
 */
import type { RawBeat, Word } from "./types";

export const SHOT_TARGET_SEC = 2.5;
export const SHOT_MIN_SEC = 1.4;
export const SHOT_MAX_SEC = 3.0;

const CLAUSE_STARTERS = new Set([
  "and", "but", "so", "because", "which", "then", "whereas", "when", "while", "if", "once", "after",
  "before", "until", "since", "although", "or", "now", "first", "second", "third", "finally", "next",
]);
/** A shot must not end on one of these: they lead into the next word. */
const DANGLING = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "by", "from", "into", "onto", "as",
  "and", "or", "but", "so", "that", "this", "these", "those", "your", "my", "our", "their", "its",
  "is", "are", "was", "were", "be", "it's", "i", "you", "we", "they", "if", "than", "then", "like",
  "can", "will", "would", "could", "should", "do", "does", "did", "not", "no", "very", "just", "all",
]);

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** How natural a cut AFTER words[i] is (higher is better, negative = avoid). */
export function breakQuality(words: Word[], i: number): number {
  const w = words[i];
  const next = words[i + 1];
  if (!next) return 3;
  let q = 0;
  if (/[.!?]["')\]]*$/.test(w.text.trim())) q = 3;
  else if (/[,;:—–-]["')\]]*$/.test(w.text.trim())) q = 2.2;
  else if (CLAUSE_STARTERS.has(norm(next.text))) q = 1.4;
  const gap = next.start - w.end;
  if (gap >= 0.35) q += 1.2;
  else if (gap >= 0.18) q += 0.6;
  if (DANGLING.has(norm(w.text)) && q < 2) q -= 2.5;
  return q;
}

/**
 * Splits `words` into shots by dynamic programming over word boundaries: each shot pays for being
 * far from SHOT_TARGET_SEC (and much more for leaving [SHOT_MIN_SEC, SHOT_MAX_SEC]) and earns the
 * break quality of the cut that ends it. Shots are made contiguous (each ends where the next
 * starts) and the first starts at 0, exactly like decide.ts's old buildBeats.
 */
export function splitShots(words: Word[]): RawBeat[] {
  const n = words.length;
  if (n === 0) {
    throw new Error(
      "splitShots: no words to build shots from — no speech was detected in this video's audio. " +
        "This pipeline turns spoken narration into a short; a source with no transcribed words " +
        "cannot honestly produce one.",
    );
  }
  const dur = (i: number, j: number) => words[j - 1].end - words[i].start; // words [i, j)
  const best: number[] = new Array(n + 1).fill(Infinity);
  const from: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const d = dur(i, j);
      if (d > SHOT_MAX_SEC * 2.2 && i < j - 1) break; // far too long, and shorter starts were already tried
      if (best[i] === Infinity) continue;
      let cost = (d - SHOT_TARGET_SEC) ** 2;
      if (d > SHOT_MAX_SEC) cost += 40 * (d - SHOT_MAX_SEC) ** 2 + 4;
      if (d < SHOT_MIN_SEC) cost += 25 * (SHOT_MIN_SEC - d) ** 2 + 2;
      const isLast = j === n;
      cost -= isLast ? 0 : breakQuality(words, j - 1);
      const total = best[i] + cost;
      if (total < best[j]) {
        best[j] = total;
        from[j] = i;
      }
    }
  }
  const cuts: number[] = [];
  for (let j = n; j > 0; j = from[j]) cuts.unshift(j);
  const groups: [number, number][] = [];
  let s = 0;
  for (const e of cuts) {
    groups.push([s, e]);
    s = e;
  }
  // a trailing sliver is folded back into the shot before it
  while (groups.length > 1) {
    const [a, b] = groups[groups.length - 1];
    if (dur(a, b) >= 1.0) break;
    groups.pop();
    groups[groups.length - 1][1] = b;
  }
  const shots: RawBeat[] = groups.map(([a, b], idx) => ({
    id: `b${idx}`,
    start: words[a].start,
    end: words[b - 1].end,
    text: words
      .slice(a, b)
      .map(w => w.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    wordRange: [a, b - 1],
  }));
  for (let i = 0; i < shots.length - 1; i++) shots[i].end = shots[i + 1].start;
  shots[0].start = 0;
  return shots;
}
