/**
 * Finds where each word's sound really starts and stops, from the audio envelope rather than
 * from transcript timestamps. Parakeet starts words up to a quarter second early and ends them
 * a third of a second late, so cutting at the timestamps leaves a long silent tail and lead at
 * every join. Pure: takes the 10 ms RMS envelope and the word list, no ffmpeg, no files.
 *
 * For each word we take its loudest frame (inside its own share of the timeline, so a loud
 * neighbour cannot claim it), then walk away from that core until the audio has stayed under
 * a threshold for EDGE_HOLD_SEC. The threshold sits EDGE_REL_DB under the word's own peak, held
 * between EDGE_FLOOR_DB and EDGE_CEIL_DB, so a quiet word and a loud word are both measured
 * fairly. The walk never passes the core of the neighbouring word. When the speech runs
 * straight into the neighbour with no quiet run in between, the edge falls back to the
 * quietest frame between the two cores and is marked as not quiet, so no padding is added.
 */
import type { Word } from "../transcribe";

export const ENV_STEP_SEC = 0.01;
/**
 * Threshold under the word's own peak, held between a floor (dead air) and a ceiling (so a loud
 * word's own breath tail is not mistaken for speech). A sound starts abruptly, so the onset
 * threshold sits low; a word dies away through a long quiet tail, and the offset threshold sits
 * higher so a flat room-tone or breath plateau after the word is not kept as part of it.
 */
export const ONSET_REL_DB = 30;
export const ONSET_FLOOR_DB = -55;
export const ONSET_CEIL_DB = -45;
export const OFFSET_REL_DB = 22;
export const OFFSET_FLOOR_DB = -52;
export const OFFSET_CEIL_DB = -40;
/** The audio has to stay under the threshold this long before a word counts as over. */
export const EDGE_HOLD_SEC = 0.07;

export interface Edge {
  /** Source seconds. */
  t: number;
  /** True when a real quiet run was found, so padding into it is safe. */
  quiet: boolean;
}

export interface WordEdges {
  /** Time of the word's loudest frame. */
  peak: number;
  /** Where the sound starts, measured against the previous word. */
  onset: Edge;
  /** Where the sound stops, measured against the next word. */
  offset: Edge;
}

const frame = (t: number) => Math.round(t / ENV_STEP_SEC);

/** Threshold for a word whose loudest frame is peakDb. */
export function edgeThreshold(peakDb: number, kind: "onset" | "offset"): number {
  const [rel, floor, ceil] = kind === "onset" ? [ONSET_REL_DB, ONSET_FLOOR_DB, ONSET_CEIL_DB] : [OFFSET_REL_DB, OFFSET_FLOOR_DB, OFFSET_CEIL_DB];
  return Math.min(ceil, Math.max(floor, peakDb - rel));
}

/** Index of the loudest frame in [a, b), clamped to the envelope. */
function argMax(env: number[], a: number, b: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(env.length, Math.max(lo + 1, b));
  let best = lo;
  for (let i = lo; i < hi; i++) if (env[i] > env[best]) best = i;
  return best;
}

function argMin(env: number[], a: number, b: number): number {
  const lo = Math.max(0, Math.min(a, env.length - 1));
  const hi = Math.min(env.length, Math.max(lo + 1, b + 1));
  let best = lo;
  for (let i = lo; i < hi; i++) if (env[i] < env[best]) best = i;
  return best;
}

/**
 * First frame f in [from, limit] whose following `hold` frames are all under thr. Used to walk
 * forward from a core to the end of the sound. Returns null when speech never lets go.
 */
export function quietRunAfter(env: number[], from: number, limit: number, thr: number, hold: number): number | null {
  const end = Math.min(limit, env.length);
  let run = 0;
  for (let i = from; i < end; i++) {
    if (env[i] < thr) {
      run++;
      if (run >= hold) return i - run + 1;
    } else run = 0;
  }
  // a quiet run that reaches the limit counts when the limit is the end of the audio
  return limit >= env.length && run > 0 ? end - run : null;
}

/**
 * The mirror image: walking backward from a core, the frame just after the last loud frame of
 * the quiet run that ends the walk. Returns null when speech never lets go.
 */
export function quietRunBefore(env: number[], from: number, limit: number, thr: number, hold: number): number | null {
  const stop = Math.max(limit, 0);
  let run = 0;
  for (let i = Math.min(from, env.length - 1); i >= stop; i--) {
    if (env[i] < thr) {
      run++;
      if (run >= hold) return i + run;
    } else run = 0;
  }
  return stop <= 0 && run > 0 ? run : null;
}

/**
 * Per-word sound edges. `env` is the 10 ms RMS envelope of the source, `durationSec` its
 * length. Words must be sorted by time. The list may contain words that will be removed:
 * their cores still bound the walks of their neighbours.
 */
export function wordEdges(env: number[], words: Word[], durationSec: number): WordEdges[] {
  const n = words.length;
  const hold = Math.max(1, Math.round(EDGE_HOLD_SEC / ENV_STEP_SEC));
  const endFrame = Math.min(env.length, frame(durationSec));
  const mid = words.map(w => (w.start + w.end) / 2);
  // each word's cell: its own span, cut at the midpoints between neighbouring word centres
  const peaks = words.map((w, k) => {
    const lo = k > 0 ? Math.max(w.start, (mid[k - 1] + mid[k]) / 2) : w.start;
    const hi = k < n - 1 ? Math.min(w.end, (mid[k] + mid[k + 1]) / 2) : w.end;
    return argMax(env, frame(lo), Math.max(frame(lo) + 1, frame(hi)));
  });
  // cores must stay in order even when two words claim the same loud frame
  for (let k = 1; k < n; k++) if (peaks[k] <= peaks[k - 1]) peaks[k] = Math.min(Math.max(peaks[k - 1] + 1, frame(mid[k])), Math.max(endFrame - 1, 0));

  const out: WordEdges[] = [];
  for (let k = 0; k < n; k++) {
    const p = peaks[k];
    const peakDb = env[p] ?? ONSET_FLOOR_DB;
    const thrOff = edgeThreshold(peakDb, "offset");
    const thrOn = edgeThreshold(peakDb, "onset");
    // offset: walk forward to the next word's core (or the end of the audio)
    const fwdLimit = k < n - 1 ? peaks[k + 1] : endFrame;
    let off: Edge;
    const f = quietRunAfter(env, p + 1, fwdLimit, thrOff, hold);
    if (f !== null) off = { t: f * ENV_STEP_SEC, quiet: true };
    else if (k < n - 1) off = { t: argMin(env, p, fwdLimit) * ENV_STEP_SEC, quiet: false };
    else off = { t: endFrame * ENV_STEP_SEC, quiet: false };
    // onset: walk backward to the previous word's core (or the start of the audio)
    const backLimit = k > 0 ? peaks[k - 1] : 0;
    let on: Edge;
    const b = quietRunBefore(env, p - 1, backLimit, thrOn, hold);
    if (b !== null) on = { t: b * ENV_STEP_SEC, quiet: true };
    else if (k > 0) on = { t: argMin(env, backLimit, p) * ENV_STEP_SEC, quiet: false };
    else on = { t: 0, quiet: false };
    out.push({ peak: p * ENV_STEP_SEC, onset: on, offset: off });
  }
  return out;
}

/**
 * The words with their times replaced by the real sound edges, kept in order and never shorter
 * than MIN_WORD_SEC. Cut edges sit outside these times, so every kept word lies inside a keep
 * range and survives remapWords, with caption times that match the audio.
 */
export function snapWordsToEdges(words: Word[], edges: WordEdges[]): Word[] {
  const MIN_WORD_SEC = 0.04;
  const out: Word[] = [];
  let prevEnd = 0;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    let start = Math.max(edges[k].onset.t, prevEnd);
    let end = edges[k].offset.t;
    if (end - start < MIN_WORD_SEC) {
      // the edges collapsed (a word the audio barely has): keep the transcript's own span
      start = Math.max(w.start, prevEnd);
      end = Math.max(w.end, start + MIN_WORD_SEC);
    }
    out.push({ ...w, start, end });
    prevEnd = end;
  }
  return out;
}
