import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLEAN } from "./constants";
import { planKeep } from "./keep";
import {
  findUntranscribedSpans,
  mapBatchWords,
  mergeWords,
  planBatch,
  spansToProtect,
  KEEP_UNTRANSCRIBED_SEC,
} from "./recover";
import { script } from "./testutil";
import type { Interval, Range } from "./types";

const FPS = 30;
const sumKeeps = (k: Range[]) => k.reduce((a, r) => a + r.end - r.start, 0);

// synthetic clip: words, then 10 s of mostly quiet air with two voiced islands that have no words
//   words 0-0.9 | quiet 0.9-3.0 | voiced 3.0-4.8 (1.8 s) | quiet 4.8-7.0 | voiced 7.0-7.8 (0.8 s) | quiet 7.8-9.5 | words
const words = [...script("alpha bravo charlie", { gap: 0 }), ...script("delta echo foxtrot", { gap: 0, t0: 9.5 }).map(w => ({ ...w, i: w.i + 3 }))];
const DUR = 11;
const silences: Interval[] = [
  { start: 0.9, end: 3.0 },
  { start: 4.8, end: 7.0 },
  { start: 7.8, end: 9.5 },
  { start: 10.4, end: DUR },
];

test("voiced spans with no words are found, quiet ones are not", () => {
  const spans = findUntranscribedSpans(words, silences, DUR);
  assert.deepEqual(spans.map(s => [s.start, s.end]), [[3.0, 4.8], [7.0, 7.8]]);
  assert.equal(spans[0].prev, 2);
  assert.equal(spans[0].next, 3);
});

test("a voiced span shorter than 0.6 s is left to the filler rule", () => {
  const sil: Interval[] = [{ start: 0.9, end: 3.0 }, { start: 3.5, end: 9.5 }];
  assert.equal(findUntranscribedSpans(words, sil, DUR).length, 0);
});

test("words heard in the batch map back to source time and into the right span", () => {
  const spans = findUntranscribedSpans(words, silences, DUR);
  const segs = planBatch(spans, DUR, 0.3, 1.0);
  // batch layout: seg0 = source 2.7-5.1 (2.4 s) at 0, seg1 starts at 3.4 = source 6.7-8.1
  assert.ok(Math.abs(segs[1].batchStart - 3.4) < 1e-9);
  const heard = [
    { i: 0, text: "and", start: 0.5, end: 0.7 }, // source 3.2-3.4, inside span 0
    { i: 1, text: "then", start: 0.8, end: 1.1 },
    { i: 5, text: "soft", start: 0.1, end: 0.4 }, // middle 0.25 s into the pad, within the slack: kept
    { i: 2, text: "context", start: 0.0, end: 0.05 }, // in the pad before span 0: dropped
    { i: 3, text: "apply", start: 3.4 + 0.5, end: 3.4 + 0.9 }, // source 7.2-7.6, inside span 1
    { i: 4, text: "lost", start: 3.0, end: 3.2 }, // in the gap between segments: dropped
  ];
  const out = mapBatchWords(heard, segs, words);
  assert.deepEqual(out.map(w => w.text), ["and", "then", "soft", "apply"]);
  assert.ok(Math.abs(out[0].start - 3.2) < 1e-9);
  assert.ok(Math.abs(out[3].start - 7.2) < 1e-9);
});

test("a recovered word that only echoes the neighbouring word is dropped", () => {
  const spans = findUntranscribedSpans(words, silences, DUR);
  const segs = planBatch(spans, DUR, 0.3, 1.0);
  // "delta" is the word after span 1 (starts 9.5): not inside, but a fake echo near span 0's edge
  const heard = [{ i: 0, text: "Charlie.", start: 0.35, end: 0.6 }]; // source 3.05-3.3, next to "charlie" at 0.6-0.9? 2.15 s away: kept
  assert.equal(mapBatchWords(heard, segs, words).length, 1);
  const near = [
    { i: 0, text: "charlie", start: 0.3, end: 0.5 },
  ];
  // move the previous word right up against the span so the same text is an echo
  const w2 = words.map(w => (w.text === "charlie" ? { ...w, end: 3.0 } : w));
  assert.equal(mapBatchWords(near, segs, w2).length, 0);
});

test("recovered words are merged in time order and renumbered", () => {
  const merged = mergeWords(words, [{ i: 0, text: "and", start: 3.2, end: 3.4 }]);
  assert.deepEqual(merged.map(w => w.i), merged.map((_, k) => k));
  assert.equal(merged[3].text, "and");
  assert.equal(merged.length, words.length + 1);
});

test("branch 1: recovered words fill the gap, so nothing is left to protect", () => {
  const merged = mergeWords(words, [
    { i: 0, text: "and", start: 3.2, end: 3.5 },
    { i: 0, text: "then", start: 3.6, end: 4.6 },
  ]);
  const left = findUntranscribedSpans(merged, silences, DUR);
  // the 0.8 s island is still without words, but it is shorter than the keep threshold
  assert.deepEqual(left.map(s => [s.start, s.end]), [[7.0, 7.8]]);
  assert.deepEqual(spansToProtect(left, new Set()), []);
  const plan = planKeep({ words: merged, removed: new Map(), fillerSounds: [], durationSec: DUR, fps: FPS, opts: DEFAULT_CLEAN, protect: [] });
  // the quiet stretches shrink, the recovered words are never touched
  for (const w of merged) for (const c of plan.cuts) assert.ok(c.end <= w.start + 1e-6 || c.start >= w.end - 1e-6, `cut overlaps ${w.text}`);
});

test("branch 2: nothing recovered, a long span is kept and a short one stays eligible", () => {
  const spans = findUntranscribedSpans(words, silences, DUR);
  const protect = spansToProtect(spans, new Set());
  assert.deepEqual(protect.map(s => [s.start, s.end]), [[3.0, 4.8]], "1.8 s is kept, 0.8 s is not");
  assert.ok(1.8 >= KEEP_UNTRANSCRIBED_SEC && 0.8 < KEEP_UNTRANSCRIBED_SEC);

  const unprotected = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: DUR, fps: FPS, opts: DEFAULT_CLEAN });
  const guarded = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: DUR, fps: FPS, opts: DEFAULT_CLEAN, protect });
  const covers = (cuts: { start: number; end: number }[], a: number, b: number) => cuts.some(c => c.start < b && c.end > a);
  assert.ok(covers(unprotected.cuts, 3.0, 4.8), "without protection the span is deleted as silence");
  assert.ok(!covers(guarded.cuts, 3.0, 4.8), "with protection no cut touches the span");
  assert.ok(covers(guarded.cuts, 0.9 + 0.12 + 0.05, 2.5), "the quiet air before it is still cut");
  assert.ok(covers(guarded.cuts, 5.0, 6.9), "the quiet air after it is still cut");
  assert.ok(covers(guarded.cuts, 7.0, 7.8), "the short span is still eligible to be cut");
  assert.ok(sumKeeps(guarded.keeps) > sumKeeps(unprotected.keeps) + 1.7);
  // keeps and cuts still tile the clip
  const total = sumKeeps(guarded.keeps) + guarded.cuts.reduce((a, c) => a + c.end - c.start, 0);
  assert.ok(Math.abs(total - DUR) < 1e-6);
});

test("a span between two retake words belongs to the abandoned take and is not protected", () => {
  const spans = findUntranscribedSpans(words, silences, DUR);
  const removed = new Set([2, 3]);
  assert.deepEqual(spansToProtect(spans, removed), []);
  assert.equal(spansToProtect(spans, new Set([2])).length, 1, "only one side removed: still protected");
});

test("lead-in and tail speech without words is protected too", () => {
  const w = script("alpha bravo", { gap: 0, t0: 4 });
  const sil: Interval[] = [{ start: 2.0, end: 4.0 }, { start: 4.6, end: 8.0 }];
  const spans = findUntranscribedSpans(w, sil, 9.5);
  assert.deepEqual(spans.map(s => [s.start, s.end]), [[0, 2.0], [8.0, 9.5]]);
  const protect = spansToProtect(spans, new Set());
  assert.equal(protect.length, 2);
  const plan = planKeep({ words: w, removed: new Map(), fillerSounds: [], durationSec: 9.5, fps: FPS, opts: DEFAULT_CLEAN, protect });
  assert.ok(plan.keeps[0].start === 0 && plan.keeps[0].end >= 2.0, "lead speech kept");
  assert.ok(plan.keeps[plan.keeps.length - 1].end >= 9.5 - 1e-6, "tail speech kept");
});
