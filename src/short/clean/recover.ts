/**
 * Untranscribed speech. Long-form ASR sometimes drops a stretch of real speech, and the gap it
 * leaves looks like silence in the word list. The cutter must never delete voiced audio just
 * because it has no words, so this module finds voiced spans that have none, re-transcribes
 * just those spans in one batch, and merges whatever comes back into the word list. Spans that
 * still have no words afterwards are reported so the planner can protect the long ones.
 *
 * The pure parts (finding spans, mapping words back, merging, protecting) are separate from
 * the ffmpeg and parakeet calls so they can be tested with synthetic data.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Word } from "../transcribe";
import { normWord } from "./retakes";
import type { Interval, Range } from "./types";

/** A voiced stretch with no transcribed words at least this long gets a second look. */
export const RECOVER_MIN_SEC = 0.6;
/** Audio on each side of a span that the second pass hears, for context. */
export const RECOVER_PAD_SEC = 0.3;
/** Silence between spans in the batch, so the recogniser does not run them together. */
export const RECOVER_GAP_SEC = 1.0;
/** A span that stays untranscribed and is at least this long is kept, not cut. */
export const KEEP_UNTRANSCRIBED_SEC = 1.2;
/**
 * A recovered word may sit this far outside its span: the voiced detector trips a little after
 * a soft onset, so the first word's middle can fall just before the span start.
 */
const SPAN_SLACK_SEC = 0.2;
/** Recovered words this close to a neighbouring word that say the same thing are its echo. */
const ECHO_WINDOW_SEC = 0.35;

export interface VoicedSpan extends Range {
  /** Index of the word before the span in the list it was found in (-1 for the lead-in). */
  prev: number;
  /** Index of the word after the span (words.length for the tail). */
  next: number;
}

/** Voiced stretches (a gap minus its silences) of at least `minSec` that no word covers. */
export function findUntranscribedSpans(
  words: Word[],
  silences: Interval[],
  durationSec: number,
  minSec = RECOVER_MIN_SEC,
): VoicedSpan[] {
  const out: VoicedSpan[] = [];
  const bounds: { gs: number; ge: number; prev: number; next: number }[] = [];
  if (words.length === 0) bounds.push({ gs: 0, ge: durationSec, prev: -1, next: 0 });
  else {
    bounds.push({ gs: 0, ge: words[0].start, prev: -1, next: 0 });
    for (let k = 1; k < words.length; k++) bounds.push({ gs: words[k - 1].end, ge: words[k].start, prev: k - 1, next: k });
    bounds.push({ gs: words[words.length - 1].end, ge: durationSec, prev: words.length - 1, next: words.length });
  }
  for (const b of bounds) {
    if (b.ge - b.gs < minSec) continue;
    let cursor = b.gs;
    const voiced: Range[] = [];
    for (const s of silences) {
      if (s.end <= b.gs || s.start >= b.ge) continue;
      if (s.start > cursor) voiced.push({ start: cursor, end: Math.min(s.start, b.ge) });
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < b.ge) voiced.push({ start: cursor, end: b.ge });
    for (const v of voiced) if (v.end - v.start >= minSec) out.push({ ...v, prev: b.prev, next: b.next });
  }
  return out;
}

/** Where each span sits inside the batch audio. */
export interface BatchSegment {
  /** The span this segment re-transcribes, in source time. */
  span: VoicedSpan;
  /** Padded source range that was cut out for it. */
  srcStart: number;
  srcEnd: number;
  /** Where the padded range starts in the batch audio. */
  batchStart: number;
}

export function planBatch(spans: VoicedSpan[], durationSec: number, pad = RECOVER_PAD_SEC, gap = RECOVER_GAP_SEC): BatchSegment[] {
  const segs: BatchSegment[] = [];
  let t = 0;
  for (const span of spans) {
    const srcStart = Math.max(0, span.start - pad);
    const srcEnd = Math.min(durationSec, span.end + pad);
    segs.push({ span, srcStart, srcEnd, batchStart: t });
    t += srcEnd - srcStart + gap;
  }
  return segs;
}

/**
 * Maps words heard in the batch audio back to source time. A word is kept only when its middle
 * falls inside its own span, give or take a little slack (the padding is context, not new speech), and it is not an echo of
 * the neighbouring word the padding overlapped.
 */
export function mapBatchWords(heard: Word[], segs: BatchSegment[], neighbours: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of heard) {
    const mid = (w.start + w.end) / 2;
    const seg = segs.find(s => mid >= s.batchStart && mid < s.batchStart + (s.srcEnd - s.srcStart));
    if (!seg) continue;
    const start = seg.srcStart + (w.start - seg.batchStart);
    const end = seg.srcStart + (w.end - seg.batchStart);
    const m = (start + end) / 2;
    if (m < seg.span.start - SPAN_SLACK_SEC || m > seg.span.end + SPAN_SLACK_SEC) continue;
    const prev = neighbours[seg.span.prev];
    const next = neighbours[seg.span.next];
    // the slack must not pull in a word that is really a neighbour's own audio
    if (prev && m <= prev.end) continue;
    if (next && m >= next.start) continue;
    const n = normWord(w.text);
    if (!n) continue;
    if (prev && normWord(prev.text) === n && start - prev.end < ECHO_WINDOW_SEC) continue;
    if (next && normWord(next.text) === n && next.start - end < ECHO_WINDOW_SEC) continue;
    out.push({ i: 0, text: w.text, start: Math.max(0, start), end: Math.max(start, end) });
  }
  return out;
}

/** Inserts recovered words in time order and renumbers. */
export function mergeWords(words: Word[], extra: Word[]): Word[] {
  return [...words, ...extra]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((w, i) => ({ ...w, i }));
}

/** Where the extra words ended up in the merged list. */
export function indicesOf(merged: Word[], extra: Word[]): Set<number> {
  const key = (w: Word) => `${w.start}|${w.end}|${w.text}`;
  const keys = new Set(extra.map(key));
  return new Set(merged.filter(w => keys.has(key(w))).map(w => w.i));
}

/**
 * Spans that are still without words, in the final word list, and must not be cut: voiced,
 * long enough that they cannot be a filler sound, and not sitting between two removed (retake)
 * words, where they belong to the abandoned take. Shorter spans stay eligible for the filler rule.
 */
export function spansToProtect(
  spans: VoicedSpan[],
  removed: ReadonlySet<number>,
  minSec = KEEP_UNTRANSCRIBED_SEC,
): VoicedSpan[] {
  return spans.filter(s => s.end - s.start >= minSec && !(removed.has(s.prev) && removed.has(s.next)));
}

/** One ffmpeg call: the padded spans, one second of silence between them, 16 kHz mono wav. */
export function writeBatchAudio(src: string, segs: BatchSegment[], out: string): void {
  const parts = segs.map(
    (s, k) =>
      `[0:a:0]atrim=start=${s.srcStart.toFixed(3)}:end=${s.srcEnd.toFixed(3)},asetpts=PTS-STARTPTS,aresample=16000,aformat=channel_layouts=mono,apad=pad_dur=${RECOVER_GAP_SEC}[s${k}]`,
  );
  const graph = `${parts.join(";")};${segs.map((_, k) => `[s${k}]`).join("")}concat=n=${segs.length}:v=0:a=1[out]`;
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", "-loglevel", "error", "-i", src, "-filter_complex", graph, "-map", "[out]", "-ar", "16000", "-ac", "1", out], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) throw new Error(`recover batch audio failed (exit ${res.status}): ${(res.stderr ?? "").slice(-1500)}`);
}

export type Retranscribe = (audioPath: string, workDir: string) => Promise<Word[]>;

export interface RecoverResult {
  words: Word[];
  /** Spans that were re-transcribed. */
  spans: VoicedSpan[];
  /** Words the second pass added. */
  added: Word[];
  /** Their indices in the merged list, so later stages can tell recovered speech from the rest. */
  addedIndices: Set<number>;
  /** Spans that still have no word inside them after the merge, in the merged list's indices. */
  stillEmpty: VoicedSpan[];
}

/**
 * Finds untranscribed voiced spans, re-transcribes them in a single batch and merges the result.
 * `retranscribe` is the parakeet call (injected in tests).
 */
export async function recoverUntranscribed(args: {
  src: string;
  workDir: string;
  words: Word[];
  silences: Interval[];
  durationSec: number;
  retranscribe: Retranscribe;
  log?: (m: string) => void;
}): Promise<RecoverResult> {
  const { src, workDir, words, silences, durationSec, retranscribe } = args;
  const log = args.log ?? (() => {});
  const spans = findUntranscribedSpans(words, silences, durationSec);
  if (spans.length === 0) return { words, spans, added: [], addedIndices: new Set(), stillEmpty: [] };
  const segs = planBatch(spans, durationSec);
  const dir = join(workDir, "recover");
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, "spans.wav");
  writeBatchAudio(src, segs, wav);
  const heard = await retranscribe(wav, dir);
  const added = mapBatchWords(heard, segs, words);
  const merged = mergeWords(words, added);
  const addedIndices = indicesOf(merged, added);
  const stillEmpty = findUntranscribedSpans(merged, silences, durationSec);
  log(`clean: ${spans.length} voiced spans had no words, re-transcribed in one batch, ${added.length} words recovered, ${stillEmpty.length} still empty`);
  return { words: merged, spans, added, addedIndices, stillEmpty };
}
