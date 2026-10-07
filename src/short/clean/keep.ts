/**
 * Turns "these words are removed" plus the audio's silences into KEEP ranges and the list of
 * cuts, all in source time. Pure: no ffmpeg, no files.
 *
 * Every gap between two kept words is handled the same way: if removed words or a non-word
 * sound sit in it, or the true silence between the two words is longer than maxGap, it shrinks
 * to padAfter after the earlier word's sound and padBefore before the later one's. Where a
 * sound starts and stops comes from the audio envelope (edges.ts), not from word timestamps,
 * which are early at the start and late at the end. The lead-in and tail shrink to the same
 * padding. Cut edges are rounded to the nearest frame but never closer than EDGE_MARGIN_SEC
 * to the sound, so a cut cannot clip a word.
 */
import type { Word } from "../transcribe";
import { EDGE_MARGIN_SEC } from "./constants";
import { wordEdges, type Edge } from "./edges";
import type { Cut, CleanOptions, CutReason, Interval, Range } from "./types";

/** Cuts shorter than this are not worth a join. */
const MIN_CUT_SEC = 0.05;
/** A non-word sound must sit this far from the words around it, or it is a word's own tail. */
const FILLER_CLEARANCE_SEC = 0.05;

export interface PlanInput {
  words: Word[];
  /** Word index -> why it is removed. */
  removed: Map<number, "retake" | "filler">;
  /** Non-word voiced sounds found in gaps (reason filler). */
  fillerSounds: Interval[];
  durationSec: number;
  fps: number;
  opts: CleanOptions;
  /** 10 ms RMS levels of the source audio. When given, cut edges follow the real sound, not word times. */
  envelope?: number[];
  /** Voiced spans without words that must stay in the output (with the breath around them). */
  protect?: Range[];
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

/**
 * Removes the protected spans (plus the breath on each side, rounded out to frames) from the
 * cuts, splitting a cut in two when a span sits in its middle. The kept side only ever grows.
 */
function subtractProtected(cuts: Cut[], protect: Range[], opts: CleanOptions, fps: number, durationSec: number): Cut[] {
  const frame = 1 / fps;
  const ranges = protect
    .map(p => ({
      start: Math.max(0, Math.floor((p.start - opts.padBefore) * fps + 1e-6) * frame),
      end: Math.min(durationSec, Math.ceil((p.end + opts.padAfter) * fps - 1e-6) * frame),
    }))
    .sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const c of cuts) {
    let pieces: Cut[] = [{ ...c }];
    for (const r of ranges) {
      const next: Cut[] = [];
      for (const pc of pieces) {
        if (r.end <= pc.start || r.start >= pc.end) {
          next.push(pc);
          continue;
        }
        if (r.start > pc.start) next.push({ ...pc, end: r.start });
        if (r.end < pc.end) next.push({ ...pc, start: r.end });
      }
      pieces = next;
    }
    for (const pc of pieces) if (pc.end - pc.start >= Math.max(MIN_CUT_SEC, frame * 1.5)) out.push(pc);
  }
  return out;
}

export function planKeep(input: PlanInput): KeepPlan {
  const { words, removed, fillerSounds, durationSec, fps, opts, envelope } = input;
  const protect = input.protect ?? [];
  const kept = words.filter(w => !removed.has(w.i));
  if (kept.length === 0) return { cuts: [], keeps: [{ start: 0, end: durationSec }] };

  const gaps: { gs: number; ge: number; lead: boolean; tail: boolean; from: number; to: number }[] = [];
  gaps.push({ gs: 0, ge: kept[0].start, lead: true, tail: false, from: -1, to: kept[0].i });
  for (let k = 1; k < kept.length; k++) {
    gaps.push({ gs: kept[k - 1].end, ge: kept[k].start, lead: false, tail: false, from: kept[k - 1].i, to: kept[k].i });
  }
  gaps.push({ gs: kept[kept.length - 1].end, ge: durationSec, lead: false, tail: true, from: kept[kept.length - 1].i, to: words.length });

  const frame = 1 / fps;
  // sound edges from the audio, or the word timestamps when there is no envelope
  const edges = envelope ? wordEdges(envelope, words, durationSec) : null;
  const offsetOf = (i: number): Edge => (edges ? edges[i].offset : { t: words[i].end, quiet: true });
  const onsetOf = (i: number): Edge => (edges ? edges[i].onset : { t: words[i].start, quiet: true });
  const snapped: Cut[] = [];
  for (const g of gaps) {
    type Item = { start: number; end: number; reason: CutReason; text: string };
    const items: Item[] = [];
    for (let i = g.from + 1; i < g.to; i++) {
      const r = removed.get(i);
      if (r) items.push({ start: onsetOf(i).t, end: Math.max(onsetOf(i).t, offsetOf(i).t), reason: r, text: words[i].text });
    }
    for (const f of fillerSounds) {
      if (f.start >= g.gs && f.end <= g.ge) items.push({ start: f.start, end: f.end, reason: "filler", text: "" });
    }
    // where the sound before and after the gap really stops and starts
    const A = g.lead ? null : words[g.from];
    const B = g.tail ? null : words[g.to];
    const aOff = A ? offsetOf(A.i) : { t: 0, quiet: false };
    const bOn = B ? onsetOf(B.i) : { t: durationSec, quiet: false };
    // the air the neighbouring words (kept or not) leave around the two kept ones
    const afterA = A ? Math.max(aOff.t, A.i + 1 < words.length ? onsetOf(A.i + 1).t : durationSec) : 0;
    const beforeB = B ? Math.min(bOn.t, B.i > 0 ? offsetOf(B.i - 1).t : 0) : durationSec;
    let base: CutReason | null = null;
    if (g.lead) base = "lead";
    else if (g.tail) base = "tail";
    else if (bOn.t - aOff.t > opts.maxGap) base = "silence";
    if (items.length === 0 && !base) continue;
    const gapReason: CutReason = base ?? "silence";
    // a join inside a phrase (no punctuation after the earlier word) can be tighter
    const tight = A !== null && B !== null && !/[.!?,;:]["')\]]*$/.test(A.text);
    const padA = tight ? opts.phrasePadAfter : opts.padAfter;
    const padB = tight ? opts.phrasePadBefore : opts.padBefore;
    let start = 0;
    let end = durationSec;
    if (A) start = aOff.quiet ? aOff.t + Math.min(padA, Math.max(0, afterA - aOff.t) / 2) : aOff.t;
    if (B) end = bOn.quiet ? bOn.t - Math.min(padB, Math.max(0, bOn.t - beforeB) / 2) : bOn.t;
    if (end - start < MIN_CUT_SEC) continue;
    // snap the whole gap to frames: nearest frame, but never closer than EDGE_MARGIN_SEC to a sound
    let S = 0;
    if (A) {
      const nearest = Math.round(start * fps) * frame;
      const minStart = aOff.quiet ? Math.min(start, aOff.t + EDGE_MARGIN_SEC) : start;
      S = nearest >= minStart - 1e-9 ? nearest : Math.ceil(start * fps - 1e-6) * frame;
    }
    let E = durationSec;
    if (B) {
      const nearest = Math.round(end * fps) * frame;
      const maxEnd = bOn.quiet ? Math.max(end, bOn.t - EDGE_MARGIN_SEC) : end;
      E = nearest <= maxEnd + 1e-9 ? nearest : Math.floor(end * fps + 1e-6) * frame;
    }
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
    snapped.push(...(protect.length ? subtractProtected(folded, protect, opts, fps, durationSec) : folded));
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
