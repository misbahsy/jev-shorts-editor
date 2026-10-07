import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLEAN } from "./constants";
import { findFillerSounds, planKeep } from "./keep";
import { script } from "./testutil";
import type { Range } from "./types";

const FPS = 30;
const sumKeeps = (k: Range[]) => k.reduce((a, r) => a + r.end - r.start, 0);

test("a long pause inside a phrase shrinks to the tighter phrase padding", () => {
  // words end at 0.9, next starts at 3.0
  const words = script("alpha bravo charlie ~2.0 delta echo foxtrot", { gap: 0 });
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4.2, fps: FPS, opts: DEFAULT_CLEAN });
  const silence = plan.cuts.filter(c => c.reason === "silence");
  assert.equal(silence.length, 1);
  const gapStart = words[2].end;
  const gapEnd = words[3].start;
  const half = 0.5 / FPS + 1e-6;
  assert.ok(Math.abs(silence[0].start - (gapStart + DEFAULT_CLEAN.phrasePadAfter)) <= half, "keeps a short breath after the word");
  assert.ok(Math.abs(silence[0].end - (gapEnd - DEFAULT_CLEAN.phrasePadBefore)) <= half, "keeps a short lead-in before the word");
});

test("a long pause after a sentence keeps the normal padding", () => {
  const words = script("alpha bravo charlie. ~2.0 delta echo foxtrot", { gap: 0 });
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4.2, fps: FPS, opts: DEFAULT_CLEAN });
  const silence = plan.cuts.filter(c => c.reason === "silence");
  assert.equal(silence.length, 1);
  const half = 0.5 / FPS + 1e-6;
  assert.ok(Math.abs(silence[0].start - (words[2].end + DEFAULT_CLEAN.padAfter)) <= half);
  assert.ok(Math.abs(silence[0].end - (words[3].start - DEFAULT_CLEAN.padBefore)) <= half);
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
  assert.ok(lead && lead.start === 0 && Math.abs(lead.end - (4 - DEFAULT_CLEAN.padBefore)) <= 0.5 / FPS + 1e-6);
  assert.ok(tail && tail.end === dur && Math.abs(tail.start - (words[2].end + DEFAULT_CLEAN.padAfter)) <= 0.5 / FPS + 1e-6);
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

test("a pause the audio does not have is not cut", () => {
  // word times claim a 1 s gap, the audio is voiced the whole time
  const words = script("alpha bravo ~1 charlie delta", { gap: 0 });
  const env = new Array(500).fill(-25);
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  assert.equal(plan.cuts.filter(c => c.reason === "silence").length, 0);
});

/** Envelope with voiced stretches [from, to) in seconds at -25 dB and -80 dB everywhere else. */
function envelopeOf(totalSec: number, voiced: [number, number][]): number[] {
  const env = new Array(Math.round(totalSec * 100)).fill(-80);
  for (const [a, b] of voiced) for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) env[i] = -25;
  return env;
}

test("with an envelope the cut follows the real sound, not the early and late word times", () => {
  // the transcript says alpha runs 0..1.0 and bravo starts at 1.3, but the sound is 0.2..0.5
  // and 2.9..3.3: parakeet's late end and early start hide a 2.4 s silence
  const words = [
    { i: 0, text: "alpha", start: 0, end: 1.0 },
    { i: 1, text: "bravo", start: 1.3, end: 3.3 },
  ];
  const env = envelopeOf(4, [[0.2, 0.5], [2.9, 3.3]]);
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 4, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  const sil = plan.cuts.find(c => c.reason === "silence");
  assert.ok(sil, "the real 2.4 s pause is cut");
  const half = 0.5 / FPS + 1e-6;
  assert.ok(Math.abs(sil.start - (0.5 + DEFAULT_CLEAN.phrasePadAfter)) <= half, `start ${sil.start}`);
  assert.ok(Math.abs(sil.end - (2.9 - DEFAULT_CLEAN.phrasePadBefore)) <= half, `end ${sil.end}`);
});

test("a pause the word times claim but the audio does not have is left alone, even with an envelope", () => {
  // word times leave 0.6 s between the words, the sound is continuous
  const words = [
    { i: 0, text: "alpha", start: 0, end: 1.0 },
    { i: 1, text: "bravo", start: 1.6, end: 2.4 },
  ];
  const env = envelopeOf(3, [[0.1, 1.2], [1.25, 2.3]]);
  const plan = planKeep({ words, removed: new Map(), fillerSounds: [], durationSec: 3, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  assert.equal(plan.cuts.filter(c => c.reason === "silence").length, 0);
});

test("a retake cut ends before the next kept word's real onset and never enters a voiced core", () => {
  // kept "one", removed "oops", kept "two". Sounds: one 0.2-0.5, oops 1.0-1.3, two 2.0-2.4
  const words = [
    { i: 0, text: "one", start: 0.0, end: 0.9 },
    { i: 1, text: "oops", start: 0.6, end: 1.7 },
    { i: 2, text: "two", start: 1.5, end: 2.8 },
  ];
  const env = envelopeOf(3.2, [[0.2, 0.5], [1.0, 1.3], [2.0, 2.4]]);
  const plan = planKeep({ words, removed: new Map([[1, "retake" as const]]), fillerSounds: [], durationSec: 3.2, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  const retake = plan.cuts.find(c => c.reason === "retake");
  assert.ok(retake && /oops/.test(retake.text));
  for (const c of plan.cuts) for (const [a, b] of [[0.2, 0.5], [2.0, 2.4]]) assert.ok(c.end <= a + 1e-6 || c.start >= b - 1e-6, `cut ${c.start}-${c.end} enters a kept word`);
  // the cut as a whole runs from just after "one" to just before "two"
  const inner = plan.cuts.filter(c => c.start >= 0.5 && c.end <= 2.0);
  const from = Math.min(...inner.map(c => c.start));
  const to = Math.max(...inner.map(c => c.end));
  assert.ok(from >= 0.5 && from <= 0.5 + 0.1 + 1e-6, `starts at ${from}`);
  assert.ok(to <= 2.0 && to >= 2.0 - 0.1 - 1e-6, `ends at ${to}`);
  assert.ok(retake.start >= 1.0 - 1e-6 && retake.end <= 1.3 + 1 / FPS + 1e-6, "the retake label sits on the removed word's own sound");
});

test("when speech runs straight into the removed word the cut falls at the valley", () => {
  const words = [
    { i: 0, text: "one", start: 0.0, end: 0.6 },
    { i: 1, text: "oops", start: 0.5, end: 1.0 },
    { i: 2, text: "two", start: 1.6, end: 2.2 },
  ];
  // one 0.2-0.5, oops 0.5-0.9 with a dip to -60 at 0.5, two 1.7-2.1
  const env = envelopeOf(2.6, [[0.2, 0.9], [1.7, 2.1]]);
  env[50] = -60;
  const plan = planKeep({ words, removed: new Map([[1, "retake" as const]]), fillerSounds: [], durationSec: 2.6, fps: FPS, opts: DEFAULT_CLEAN, envelope: env });
  const c = plan.cuts.find(x => x.reason === "retake");
  assert.ok(c);
  assert.ok(c.start >= 0.5 - 1 / FPS - 1e-6 && c.start <= 0.5 + 1 / FPS + 1e-6, `valley cut at ${c.start}`);
});
