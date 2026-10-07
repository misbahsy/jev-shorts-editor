import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLEAN } from "./constants";
import { findFillerSounds, planKeep, snapEdgeToQuiet } from "./keep";
import { script } from "./testutil";
import type { Range } from "./types";

const FPS = 30;
const sumKeeps = (k: Range[]) => k.reduce((a, r) => a + r.end - r.start, 0);

test("a long pause shrinks to the padding on each side", () => {
  // words end at 0.9, next starts at 3.0
  const words = script("alpha bravo charlie ~2.0 delta echo foxtrot", { gap: 0 });
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4.2, fps: FPS, opts: DEFAULT_CLEAN });
  const silence = plan.cuts.filter(c => c.reason === "silence");
  assert.equal(silence.length, 1);
  const gapStart = words[2].end;
  const gapEnd = words[3].start;
  assert.ok(silence[0].start >= gapStart + DEFAULT_CLEAN.padAfter - 1e-6, "keeps the breath after the word");
  assert.ok(silence[0].start <= gapStart + DEFAULT_CLEAN.padAfter + 1 / FPS + 1e-6);
  assert.ok(silence[0].end <= gapEnd - DEFAULT_CLEAN.padBefore + 1e-6, "keeps the lead-in before the word");
  assert.ok(silence[0].end >= gapEnd - DEFAULT_CLEAN.padBefore - 1 / FPS - 1e-6);
});

test("a pause at or under maxGap is left alone", () => {
  const words = script("alpha bravo ~0.3 charlie delta", { gap: 0 });
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 2, fps: FPS, opts: DEFAULT_CLEAN });
  assert.equal(plan.cuts.filter(c => c.reason === "silence").length, 0);
});

test("cuts never touch a word", () => {
  const words = script("alpha bravo ~1.5 charlie delta ~2.2 echo foxtrot golf", { gap: 0.02 });
  const dur = words[words.length - 1].end + 3;
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: dur, fps: FPS, opts: DEFAULT_CLEAN });
  for (const w of words) {
    for (const c of plan.cuts) {
      assert.ok(c.end <= w.start + 1e-6 || c.start >= w.end - 1e-6, `cut ${c.start}-${c.end} overlaps ${w.text}`);
    }
  }
});

test("lead and tail shrink to the padding", () => {
  const words = script("alpha bravo charlie", { t0: 4, gap: 0 });
  const dur = words[2].end + 5;
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: dur, fps: FPS, opts: DEFAULT_CLEAN });
  const lead = plan.cuts.find(c => c.reason === "lead");
  const tail = plan.cuts.find(c => c.reason === "tail");
  assert.ok(lead && lead.start === 0 && lead.end <= 4 - DEFAULT_CLEAN.padBefore + 1e-6);
  assert.ok(tail && tail.end === dur && tail.start >= words[2].end + DEFAULT_CLEAN.padAfter - 1e-6);
});

test("removed words are cut with their reason, and keeps are the complement", () => {
  const words = script("keep one two ~0.4 oops oops three four ~0.4 keep five", { gap: 0.02 });
  const removed = new Map<number, "retake">([[3, "retake"], [4, "retake"]]);
  const dur = words[words.length - 1].end + 0.5;
  const plan = planKeep({ words, removed, fillerSounds: [], durationSec: dur, fps: FPS, opts: DEFAULT_CLEAN });
  const retake = plan.cuts.filter(c => c.reason === "retake");
  assert.equal(retake.length, 1);
  assert.match(retake[0].text, /oops oops/);
  const cutTotal = plan.cuts.reduce((a, c) => a + c.end - c.start, 0);
  assert.ok(Math.abs(sumKeeps(plan.keeps) + cutTotal - dur) < 1e-6, "keeps plus cuts cover the whole clip");
});

test("keeps are ordered, disjoint, and on frame boundaries inside the clip", () => {
  const words = script("a1 a2 ~1.2 a3 a4 ~0.9 a5", { gap: 0.03 });
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 6, fps: FPS, opts: DEFAULT_CLEAN });
  for (let k = 0; k < plan.keeps.length; k++) {
    const r = plan.keeps[k];
    assert.ok(r.end > r.start);
    if (k > 0) assert.ok(r.start >= plan.keeps[k - 1].end);
    for (const t of [r.start, r.end]) {
      if (t > 0 && t < 6 - 1e-9) assert.ok(Math.abs(t * FPS - Math.round(t * FPS)) < 1e-6, `${t} is not on a frame`);
    }
  }
});

test("voiced non-word sounds in a gap are found, long or short ones are not", () => {
  const words = script("alpha bravo ~2 charlie delta", { gap: 0 });
  // gap is 0.6 .. 2.6. Silence everywhere except a 0.4 s voiced stretch at 1.2..1.6
  const silences = [
    { start: 0.6, end: 1.2 },
    { start: 1.6, end: 2.6 },
  ];
  const sounds = findFillerSounds(words, silences, 4, DEFAULT_CLEAN);
  assert.equal(sounds.length, 1);
  assert.ok(Math.abs(sounds[0].start - 1.2) < 1e-6 && Math.abs(sounds[0].end - 1.6) < 1e-6);
  const tooLong = findFillerSounds(words, [{ start: 0.6, end: 0.7 }, { start: 2.2, end: 2.6 }], 4, DEFAULT_CLEAN);
  assert.equal(tooLong.length, 0, "a 1.5 s voiced stretch could be speech");
  const tooShort = findFillerSounds(words, [{ start: 0.6, end: 1.2 }, { start: 1.3, end: 2.6 }], 4, DEFAULT_CLEAN);
  assert.equal(tooShort.length, 0, "a 0.1 s blip is not a filler");
});

test("a voiced stretch glued to a word is that word's tail, not a filler", () => {
  const words = script("alpha bravo ~1 charlie delta", { gap: 0 });
  const sounds = findFillerSounds(words, [{ start: 0.9, end: 1.6 }], 4, DEFAULT_CLEAN);
  assert.equal(sounds.length, 0);
});

test("snapEdgeToQuiet moves a cut start past a loud tail, and gives up when speech never stops", () => {
  const env = new Array(300).fill(-80);
  for (let i = 100; i < 125; i++) env[i] = -25; // voiced 1.00 .. 1.25
  const s = snapEdgeToQuiet(env, 1.15, 1);
  assert.ok(s !== null && s >= 1.25 + 0.03 - 1e-6 && s <= 1.15 + 0.15 + 1e-6);
  const e = snapEdgeToQuiet(env, 1.05, -1);
  assert.ok(e !== null && e + 0.03 <= 1.0 + 1e-6, "an end edge moves back before the voiced stretch");
  const loud = new Array(300).fill(-25);
  assert.equal(snapEdgeToQuiet(loud, 1.0, 1), null);
});

test("a pause the audio does not have is not cut", () => {
  // word times claim a 1 s gap, the audio is voiced the whole time
  const words = script("alpha bravo ~1 charlie delta", { gap: 0 });
  const env = new Array(500).fill(-25);
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  assert.equal(plan.cuts.filter(c => c.reason === "silence").length, 0);
});
