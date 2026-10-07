/**
 * Turns "these words are removed" plus the audio's silences into KEEP ranges and the list of
 * cuts, all in source time. Pure: no ffmpeg, no files.
 *
 * Every gap between two kept words is handled the same way: if removed words or a non-word
 * sound sit in it, or it is longer than maxGap, it shrinks to padAfter after the earlier word
 * and padBefore before the later one. The lead-in and tail shrink to the same padding. Cut
 * edges are snapped inward to frame boundaries, so a cut can never clip a word.
 */
import type { Word } from "../transcribe";
import type { Cut, CleanOptions, CutReason, Interval, Range } from "./types";

/** Cuts shorter than this are not worth a join. */
const MIN_CUT_SEC = 0.05;
/** A non-word sound must sit this far from the words around it, or it is a word's own tail. */
const FILLER_CLEARANCE_SEC = 0.05;

/** Loudness (dBFS, 10 ms RMS) above which a cut edge would land inside a voiced sound. */
export const QUIET_DB = -45;
/** How far a cut edge may move toward the speech to find a quiet spot. */
export const MAX_EDGE_SHIFT_SEC = 0.15;
const ENV_STEP_SEC = 0.01;
const EDGE_WINDOW_SEC = 0.03;

function levelMax(env: number[], a: number, b: number): number {
  const i0 = Math.max(0, Math.floor(a / ENV_STEP_SEC + 1e-6));
  const i1 = Math.min(env.length, Math.max(i0 + 1, Math.ceil(b / ENV_STEP_SEC - 1e-6)));
  let m = -90;
  for (let i = i0; i < i1; i++) if (env[i] > m) m = env[i];
  return m;
}

/**
 * Moves one edge of a cut toward the kept speech until the 30 ms of kept audio at the edge
 * is quiet, so the join never lands inside a voiced sound. dir +1: a cut START (moves later,
 * the kept audio is the 30 ms before it). dir -1: a cut END (moves earlier, the kept audio is
 * the 30 ms after it). Returns null when nothing quiet is within reach.
 */
export function snapEdgeToQuiet(env: number[], t: number, dir: 1 | -1): number | null {
  for (let d = 0; d <= MAX_EDGE_SHIFT_SEC + 1e-9; d += ENV_STEP_SEC) {
    const e = t + dir * d;
    const lvl = dir === 1 ? levelMax(env, e - EDGE_WINDOW_SEC, e) : levelMax(env, e, e + EDGE_WINDOW_SEC);
    // the kept audio next to the join must be quiet: the 30 ms before a start edge, the 30 ms after an end edge
    if (lvl < QUIET_DB) return e;
  }
  return null;
}

export interface PlanInput {
  words: Word[];
  /** Word index -> why it is removed. */
  removed: Map<number, "retake" | "filler">;
  /** Non-word voiced sounds found in gaps (reason filler). */
  fillerSounds: Interval[];
  durationSec: number;
  fps: number;
  opts: CleanOptions;
  /** 10 ms RMS levels of the source audio. When given, cut edges avoid voiced sounds. */
  envelope?: number[];
}

export interface KeepPlan {
  cuts: Cut[];
  keeps: Range[];
}

/** Voiced stretches in the gaps between words that are the right length for an um or uh. */
export function findFillerSounds(words: Word[], silences: Interval[], durationSec: number, opts: CleanOptions): Interval[] {
  const out: Interval[] = [];
  const bounds: [number, number][] = [];
  if (words.length === 0) return out;
  bounds.push([0, words[0].start]);
  for (let k = 1; k < words.length; k++) bounds.push([words[k - 1].end, words[k].start]);
  bounds.push([words[words.length - 1].end, durationSec]);
  for (let g = 0; g < bounds.length; g++) {
    const [gs, ge] = bounds[g];
    if (ge - gs < opts.fillerMin) continue;
    // voiced = the gap minus the silences inside it
    let cursor = gs;
    const voiced: Interval[] = [];
    for (const s of silences) {
      if (s.end <= gs || s.start >= ge) continue;
      if (s.start > cursor) voiced.push({ start: cursor, end: Math.min(s.start, ge) });
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < ge) voiced.push({ start: cursor, end: ge });
    for (const v of voiced) {
      const len = v.end - v.start;
      if (len < opts.fillerMin || len > opts.fillerMax) continue;
      const touchesPrev = g > 0 && v.start - gs < FILLER_CLEARANCE_SEC;
      const touchesNext = g < bounds.length - 1 && ge - v.end < FILLER_CLEARANCE_SEC;
      if (touchesPrev || touchesNext) continue;
      out.push(v);
    }
  }
  return out;
}

export function planKeep(input: PlanInput): KeepPlan {
  const { words, removed, fillerSounds, durationSec, fps, opts, envelope } = input;
  const kept = words.filter(w => !removed.has(w.i));
  if (kept.length === 0) return { cuts: [], keeps: [{ start: 0, end: durationSec }] };

  const gaps: { gs: number; ge: number; lead: boolean; tail: boolean; from: number; to: number }[] = [];
  gaps.push({ gs: 0, ge: kept[0].start, lead: true, tail: false, from: -1, to: kept[0].i });
  for (let k = 1; k < kept.length; k++) {
    gaps.push({ gs: kept[k - 1].end, ge: kept[k].start, lead: false, tail: false, from: kept[k - 1].i, to: kept[k].i });
  }
  gaps.push({ gs: kept[kept.length - 1].end, ge: durationSec, lead: false, tail: true, from: kept[kept.length - 1].i, to: words.length });

  const frame = 1 / fps;
  const snapped: Cut[] = [];
  for (const g of gaps) {
    type Item = { start: number; end: number; reason: CutReason; text: string };
    const items: Item[] = [];
    for (let i = g.from + 1; i < g.to; i++) {
      const r = removed.get(i);
      if (r) items.push({ start: words[i].start, end: words[i].end, reason: r, text: words[i].text });
    }
    for (const f of fillerSounds) {
      if (f.start >= g.gs && f.end <= g.ge) items.push({ start: f.start, end: f.end, reason: "filler", text: "" });
    }
    const length = g.ge - g.gs;
    let base: CutReason | null = null;
    if (g.lead) base = "lead";
    else if (g.tail) base = "tail";
    else if (length > opts.maxGap) base = "silence";
    if (items.length === 0 && !base) continue;
    const gapReason: CutReason = base ?? "silence";
    let start = g.lead ? 0 : g.gs + opts.padAfter;
    let end = g.tail ? durationSec : g.ge - opts.padBefore;
    if (envelope) {
      const s2 = g.lead ? start : snapEdgeToQuiet(envelope, start, 1);
      const e2 = g.tail ? end : snapEdgeToQuiet(envelope, end, -1);
      if (s2 === null || e2 === null) {
        // no quiet spot at an edge. A pause the word timings claim but the audio does not have
        // is left alone. Removed words still go, edges unmoved.
        if (items.length === 0) continue;
      } else {
        start = Math.min(end, s2);
        end = Math.max(start, e2);
      }
    }
    if (end - start < MIN_CUT_SEC) continue;
    // snap the whole gap inward to frames: the kept side only ever grows
    const S = start === 0 ? 0 : Math.ceil(start * fps - 1e-6) * frame;
    const E = end >= durationSec - 1e-9 ? durationSec : Math.floor(end * fps + 1e-6) * frame;
    if (E - S < frame * 1.5) continue;
    // label the gap: removed words and sounds keep their own reason, the air around them is silence
    items.sort((x, y) => x.start - y.start);
    const segs: Cut[] = [];
    let cur = S;
    const push = (to: number, reason: CutReason, text: string) => {
      const t = Math.min(E, Math.max(cur, Math.round(to * fps) * frame));
      if (t - cur < 1e-9) return;
      const last = segs[segs.length - 1];
      if (last && last.reason === reason) {
        last.end = t;
        if (text) last.text = last.text ? `${last.text} ${text}` : text;
      } else segs.push({ start: cur, end: t, reason, text });
      cur = t;
    };
    for (const it of items) {
      push(it.start, gapReason, "");
      push(it.end, it.reason, it.text);
    }
    push(E, gapReason, "");
    // a retake's own pause belongs to the retake: fold silence segments between retake words into it
    for (let s = 1; s < segs.length - 1; s++) {
      if (segs[s].reason === "silence" && segs[s - 1].reason === "retake" && segs[s + 1].reason === "retake") segs[s].reason = "retake";
    }
    const folded: Cut[] = [];
    for (const sg of segs) {
      const last = folded[folded.length - 1];
      if (last && last.reason === sg.reason) {
        last.end = sg.end;
        if (sg.text) last.text = last.text ? `${last.text} ${sg.text}` : sg.text;
      } else folded.push({ ...sg });
    }
    snapped.push(...folded);
  }
  const keeps: Range[] = [];
  let cursor = 0;
  for (const c of snapped) {
    if (c.start > cursor + 1e-9) keeps.push({ start: cursor, end: c.start });
    cursor = c.end;
  }
  if (cursor < durationSec - 1e-9) keeps.push({ start: cursor, end: durationSec });
  return { cuts: snapped, keeps };
}
