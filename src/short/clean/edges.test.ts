import test from "node:test";
import assert from "node:assert/strict";
import { snapWordsToEdges, edgeThreshold, quietRunAfter, quietRunBefore, wordEdges, ONSET_CEIL_DB, ONSET_FLOOR_DB, OFFSET_CEIL_DB, OFFSET_FLOOR_DB } from "./edges";
import type { Word } from "../transcribe";

const w = (i: number, start: number, end: number): Word => ({ i, text: `w${i}`, start, end });
/** -80 dB everywhere except the given stretches, each with its own level. */
function env(totalSec: number, voiced: [number, number, number][]): number[] {
  const e = new Array(Math.round(totalSec * 100)).fill(-80);
  for (const [a, b, db] of voiced) for (let i = Math.round(a * 100); i < Math.round(b * 100); i++) e[i] = db;
  return e;
}
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

test("the threshold follows the word's own peak, held between the floor and the ceiling", () => {
  assert.equal(edgeThreshold(-10, "onset"), ONSET_CEIL_DB);
  assert.equal(edgeThreshold(-70, "onset"), ONSET_FLOOR_DB);
  assert.equal(edgeThreshold(-20, "onset"), -50);
  assert.equal(edgeThreshold(-10, "offset"), OFFSET_CEIL_DB);
  assert.equal(edgeThreshold(-70, "offset"), OFFSET_FLOOR_DB);
  assert.equal(edgeThreshold(-25, "offset"), -47);
  assert.ok(edgeThreshold(-25, "offset") > edgeThreshold(-25, "onset"), "a word's tail is judged more strictly than its start");
});

test("quiet-run walks find the end and start of a sound and give up on continuous speech", () => {
  const e = env(1, [[0.2, 0.5, -25]]);
  assert.equal(quietRunAfter(e, 30, 100, -50, 7), 50);
  assert.equal(quietRunBefore(e, 30, 0, -50, 7), 20);
  const loud = env(1, [[0, 1, -25]]);
  assert.equal(quietRunAfter(loud, 10, 100, -50, 7), null);
  assert.equal(quietRunBefore(loud, 90, 0, -50, 7), null);
});

test("sound edges ignore transcript timestamps that are early at the start and late at the end", () => {
  // true sound: 0.50-0.80 and 1.80-2.20. The transcript says 0.25-1.20 and 1.55-2.60
  const e = env(3, [[0.5, 0.8, -22], [1.8, 2.2, -22]]);
  const edges = wordEdges(e, [w(0, 0.25, 1.2), w(1, 1.55, 2.6)], 3);
  assert.ok(near(edges[0].onset.t, 0.5), `onset ${edges[0].onset.t}`);
  assert.ok(near(edges[0].offset.t, 0.8), `offset ${edges[0].offset.t}`);
  assert.ok(near(edges[1].onset.t, 1.8), `onset ${edges[1].onset.t}`);
  assert.ok(near(edges[1].offset.t, 2.2), `offset ${edges[1].offset.t}`);
  assert.ok(edges.every(x => x.onset.quiet && x.offset.quiet));
});

test("a fading tail counts as sound until it is under the word's own threshold", () => {
  // peak -25 so the offset threshold is -47. The tail drifts -42, -44, -46 then drops
  const e = env(2, [[0.5, 0.8, -25]]);
  e[80] = -42;
  e[81] = -44;
  e[82] = -46;
  const [x] = wordEdges(e, [w(0, 0.4, 1.4)], 2);
  assert.ok(near(x.offset.t, 0.83), `offset ${x.offset.t}`);
});

test("a flat plateau well under the word's level after it is not kept as part of the word", () => {
  // word at -22 (offset threshold -44), then 200 ms of -41 hush that the word's tail would not reach
  const e = env(2, [[0.5, 0.8, -22], [0.8, 1.0, -48]]);
  const [x] = wordEdges(e, [w(0, 0.4, 1.4)], 2);
  assert.ok(near(x.offset.t, 0.8), `offset ${x.offset.t}`);
});

test("a quiet word is measured against its own level, not the loud one next to it", () => {
  // loud word at -15 dB, quiet word at -48 dB with a floor-level threshold of -55
  const e = env(3, [[0.2, 0.6, -15], [1.5, 1.9, -48]]);
  const edges = wordEdges(e, [w(0, 0.1, 0.9), w(1, 1.3, 2.2)], 3);
  assert.ok(near(edges[1].onset.t, 1.5), `onset ${edges[1].onset.t}`);
  assert.ok(near(edges[1].offset.t, 1.9), `offset ${edges[1].offset.t}`);
});

test("a short dip inside a word does not end it", () => {
  // 0.3-0.5 and 0.54-0.8: a 40 ms closure, shorter than the hold
  const e = env(2, [[0.3, 0.5, -25], [0.54, 0.8, -25]]);
  const [x] = wordEdges(e, [w(0, 0.2, 1.2)], 2);
  assert.ok(near(x.offset.t, 0.8), `offset ${x.offset.t}`);
});

test("speech running straight into the next word falls back to the valley, not marked quiet", () => {
  const e = env(2, [[0.2, 1.0, -25]]);
  e[60] = -58;
  const edges = wordEdges(e, [w(0, 0.1, 0.65), w(1, 0.55, 1.1)], 2);
  assert.ok(near(edges[0].offset.t, 0.6, 0.02), `offset ${edges[0].offset.t}`);
  assert.equal(edges[0].offset.quiet, false);
  assert.ok(near(edges[1].onset.t, 0.6, 0.02));
  assert.equal(edges[1].onset.quiet, false);
});

test("a word at the very start or end of the audio gets edges at 0 and the duration when the audio is silent around it", () => {
  const e = env(2, [[0.3, 0.9, -25]]);
  const [x] = wordEdges(e, [w(0, 0.2, 1.3)], 2);
  assert.ok(near(x.onset.t, 0.3));
  assert.ok(near(x.offset.t, 0.9));
});

test("a loud neighbour cannot claim a quiet word's core", () => {
  // loud word 0.2-0.5 at -15. Word 1's transcript starts early at 0.4 but its sound is 0.9-1.2 at -40
  const e = env(2, [[0.2, 0.5, -15], [0.9, 1.2, -40]]);
  const edges = wordEdges(e, [w(0, 0.1, 0.6), w(1, 0.4, 1.6)], 2);
  assert.ok(near(edges[0].offset.t, 0.5), `offset ${edges[0].offset.t}`);
  assert.ok(near(edges[1].onset.t, 0.9), `onset ${edges[1].onset.t}`);
});

test("snapped word times follow the sound, stay ordered, and never collapse", () => {
  const e = env(3, [[0.5, 0.8, -22], [1.8, 2.2, -22]]);
  const words = [w(0, 0.25, 1.2), w(1, 1.55, 2.6)];
  const snapped = snapWordsToEdges(words, wordEdges(e, words, 3));
  assert.ok(near(snapped[0].start, 0.5) && near(snapped[0].end, 0.8));
  assert.ok(near(snapped[1].start, 1.8) && near(snapped[1].end, 2.2));
  assert.equal(snapped[1].text, "w1");
  // two words claiming the same sound do not overlap or shrink to nothing
  const e2 = env(2, [[0.5, 0.9, -22]]);
  const twins = [w(0, 0.4, 0.7), w(1, 0.6, 1.0)];
  const s2 = snapWordsToEdges(twins, wordEdges(e2, twins, 2));
  assert.ok(s2[1].start >= s2[0].end - 1e-9);
  assert.ok(s2.every(x => x.end - x.start >= 0.04 - 1e-9));
});
