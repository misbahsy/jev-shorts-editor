import test from "node:test";
import assert from "node:assert/strict";
import { refineWords } from "./refine";

test("a word that starts inside a silence begins when the silence ends", () => {
  const words = [{ i: 0, text: "hello", start: 1.0, end: 1.8 }];
  const out = refineWords(words, [{ start: 0.2, end: 1.3 }]);
  assert.ok(Math.abs(out[0].start - 1.3) < 1e-9);
  assert.equal(out[0].end, 1.8);
});

test("a word that ends inside a silence stops when the silence starts", () => {
  const words = [{ i: 0, text: "hello", start: 1.0, end: 2.2 }];
  const out = refineWords(words, [{ start: 1.6, end: 3.0 }]);
  assert.equal(out[0].start, 1.0);
  assert.ok(Math.abs(out[0].end - 1.6) < 1e-9);
});

test("a word lying wholly inside a silence slides to the silence end", () => {
  const words = [
    { i: 0, text: "now", start: 99.2, end: 99.44 },
    { i: 1, text: "you", start: 99.44, end: 99.7 },
  ];
  const out = refineWords(words, [{ start: 93.6, end: 99.5 }]);
  assert.ok(Math.abs(out[0].start - 99.5) < 1e-9);
  assert.ok(Math.abs(out[0].end - 99.74) < 1e-9);
  assert.ok(out[1].start >= out[0].end - 0.03, "the next word does not overlap");
});

test("words away from any silence are untouched, and no word ever overlaps the previous one", () => {
  const words = [
    { i: 0, text: "a", start: 0, end: 0.5 },
    { i: 1, text: "b", start: 0.4, end: 0.9 },
    { i: 2, text: "c", start: 1, end: 1.4 },
  ];
  const out = refineWords(words, [{ start: 5, end: 6 }]);
  assert.equal(out[0].start, 0);
  assert.equal(out[2].start, 1);
  assert.ok(out[1].start >= out[0].end - 1e-9);
});
