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

/** True when the word lies fully inside one keep range. */
function insideKeep(w: { start: number; end: number }, keeps: Range[]): boolean {
  return keeps.some(k => w.start >= k.start - 1e-6 && w.end <= k.end + 1e-6);
}

/** The words that survive the cut, re-indexed, with times on the output clock. */
export function remapWords(words: Word[], keeps: Range[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    if (!insideKeep(w, keeps)) continue;
    out.push({ i: out.length, text: w.text, start: remapTime(w.start, keeps), end: remapTime(w.end, keeps) });
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
