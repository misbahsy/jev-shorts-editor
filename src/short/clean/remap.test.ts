import test from "node:test";
import assert from "node:assert/strict";
import { cutPoints, keptDuration, remapTime, remapWords } from "./remap";
import { script } from "./testutil";

const keeps = [
  { start: 0, end: 2 },
  { start: 5, end: 8 },
  { start: 10, end: 11 },
];

test("kept duration is the sum of the ranges", () => {
  assert.equal(keptDuration(keeps), 6);
});

test("source times map to output times across joins", () => {
  assert.equal(remapTime(1, keeps), 1);
  assert.equal(remapTime(5, keeps), 2);
  assert.equal(remapTime(6.5, keeps), 3.5);
  assert.equal(remapTime(10.5, keeps), 5.5);
  assert.equal(remapTime(3, keeps), 2, "inside a cut lands on the join");
});

test("words inside a keep are remapped and re-indexed, words that touch a cut are dropped", () => {
  const words = [
    { i: 0, text: "a", start: 0.2, end: 0.6 },
    { i: 1, text: "b", start: 1.8, end: 2.3 }, // straddles the cut
    { i: 2, text: "c", start: 5.1, end: 5.5 },
    { i: 3, text: "d", start: 9, end: 9.4 }, // inside a cut
    { i: 4, text: "e", start: 10.2, end: 10.6 },
  ];
  const out = remapWords(words, keeps);
  assert.deepEqual(out.map(w => w.text), ["a", "c", "e"]);
  assert.deepEqual(out.map(w => w.i), [0, 1, 2]);
  assert.ok(Math.abs(out[1].start - 2.1) < 1e-9 && Math.abs(out[1].end - 2.5) < 1e-9);
  assert.ok(Math.abs(out[2].start - 5.2) < 1e-9);
});

test("remapped words stay ordered and keep their duration", () => {
  const words = script("a b c d e f g h", { dur: 0.25, gap: 0.5 });
  const out = remapWords(words, [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  for (let k = 0; k < out.length; k++) {
    assert.ok(Math.abs(out[k].end - out[k].start - 0.25) < 1e-9);
    if (k > 0) assert.ok(out[k].start >= out[k - 1].end);
  }
});

test("cut points are output-time joins, small removals are skipped, close joins collapse", () => {
  const pts = cutPoints(
    [
      { start: 0, end: 4 },
      { start: 4.1, end: 6 }, // removed only 0.1: not visible
      { start: 8, end: 10 }, // join at 5.9
      { start: 12, end: 13 }, // join at 7.9 (2 s after)
      { start: 15, end: 16 }, // join at 8.9: within 1.5 s of the previous, collapses
    ],
  );
  assert.deepEqual(pts.map(p => Number(p.toFixed(2))), [5.9, 7.9]);
});
