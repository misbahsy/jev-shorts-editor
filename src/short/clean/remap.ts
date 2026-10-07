/** Source time to output time, once the KEEP ranges are joined end to end. Pure. */
import type { Word } from "../transcribe";
import type { Range } from "./types";
import { CUT_COLLAPSE_SEC, MIN_VISIBLE_CUT_SEC } from "./constants";

export function keptDuration(keeps: Range[]): number {
  return keeps.reduce((a, k) => a + (k.end - k.start), 0);
}

/** Output time of source time t. A t inside a removed span lands on the join after it. */
export function remapTime(t: number, keeps: Range[]): number {
  let acc = 0;
  for (const k of keeps) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

/**
 * The keep range a word belongs to: the one holding its center. A word that sticks out a
 * little past a cut edge (the cut follows the sound, the timestamp can lag) still belongs to
 * it; a word that is half or more outside is a cut word.
 */
function keepOf(w: { start: number; end: number }, keeps: Range[]): Range | undefined {
  const mid = (w.start + w.end) / 2;
  return keeps.find(k => mid >= k.start && mid <= k.end);
}

/** The words that survive the cut, re-indexed, with times on the output clock (clamped to their keep). */
export function remapWords(words: Word[], keeps: Range[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const k = keepOf(w, keeps);
    if (!k) continue;
    out.push({
      i: out.length,
      text: w.text,
      start: remapTime(Math.max(w.start, k.start), keeps),
      end: remapTime(Math.min(w.end, k.end), keeps),
    });
  }
  return out;
}

/**
 * Output times where one keep range ends and the next begins, filtered to the joins that need
 * a framing change: the removed span was long enough to notice, and the previous change is far
 * enough back that toggling again would just flicker.
 */
export function cutPoints(keeps: Range[], minRemoved = MIN_VISIBLE_CUT_SEC, collapse = CUT_COLLAPSE_SEC): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let k = 0; k < keeps.length - 1; k++) {
    acc += keeps[k].end - keeps[k].start;
    const removed = keeps[k + 1].start - keeps[k].end;
    if (removed < minRemoved) continue;
    if (out.length > 0 && acc - out[out.length - 1] < collapse) continue;
    out.push(acc);
  }
  return out;
}
