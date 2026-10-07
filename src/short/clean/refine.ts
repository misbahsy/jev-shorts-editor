/**
 * Word timing repair. parakeet places word edges 0.25 to 0.35 s off the audio around pauses
 * (late ends, early starts), so the cut planner cannot trust them next to a silence. Where a
 * silencedetect interval covers a word's start or end, the edge moves to the silence boundary.
 * Pure functions of the word list and the silence intervals.
 */
import type { Word } from "../transcribe";
import type { Interval } from "./types";

/** A word keeps at least this much of its own length when an edge moves. */
const MIN_WORD_SEC = 0.04;
const EDGE_SLACK_SEC = 0.02;
/** The most a word is slid forward out of a silence that covers it. */
const MAX_SLIDE_SEC = 0.6;

export function refineWords(words: Word[], silences: Interval[]): Word[] {
  const out = words.map(w => ({ ...w }));
  for (let k = 0; k < out.length; k++) {
    const w = out[k];
    const s0 = w.start;
    const e0 = w.end;
    for (const s of silences) {
      if (s.end <= s0 || s.start >= e0) continue;
      // silence covers the whole word: parakeet put it up to a few tenths early, so the voice
      // is the first thing after the silence. Slide the word to the silence end.
      if (s.start <= s0 + EDGE_SLACK_SEC && s.end >= e0 - EDGE_SLACK_SEC && s.end - s0 <= MAX_SLIDE_SEC) {
        w.start = s.end;
        w.end = s.end + Math.max(e0 - s0, MIN_WORD_SEC);
        continue;
      }
      // silence covers the start of the word: the voice begins when the silence ends
      if (s.start <= s0 + EDGE_SLACK_SEC && s.end < e0 - MIN_WORD_SEC && s.end > w.start) w.start = s.end;
      // silence covers the end of the word: the voice stops when the silence begins
      if (s.end >= e0 - EDGE_SLACK_SEC && s.start > s0 + MIN_WORD_SEC && s.start < w.end) w.end = s.start;
    }
    if (w.end - w.start < MIN_WORD_SEC && w.start === s0) {
      w.start = s0;
      w.end = e0;
    }
  }
  // edges never cross the neighbouring word
  for (let k = 1; k < out.length; k++) {
    if (out[k].start < out[k - 1].end) {
      out[k].start = out[k - 1].end;
      out[k].end = Math.max(out[k].end, out[k].start + MIN_WORD_SEC);
    }
  }
  return out;
}
