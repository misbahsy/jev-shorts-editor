import test from "node:test";
import assert from "node:assert/strict";
import { chainCandidates, describeCandidate, findRetakeCandidates, mergeSpans } from "./retakes";
import { script } from "./testutil";

const text = (words: ReturnType<typeof script>, c: { start: number; end: number }) =>
  words.slice(c.start, c.end).map(w => w.text).join(" ");

test("a repeated sentence after a pause is a retake of the first one", () => {
  const words = script("Okay so mango river lantern copper window. ~0.8 Okay so mango river lantern copper window. Then more words follow here.");
  const cands = findRetakeCandidates(words);
  assert.ok(cands.length >= 1);
  const c = cands[0];
  assert.equal(c.start, 0, "the earlier take is the one removed");
  assert.equal(text(words, c), "Okay so mango river lantern copper window.");
});

test("the later take wins when the retake has one slipped word", () => {
  const words = script("We build mango river lantern copper window today. ~0.7 We build mango river lantern silver window today. Next idea starts now.");
  const cands = findRetakeCandidates(words);
  assert.ok(cands.length >= 1);
  assert.ok(cands[0].start === 0 && cands[0].end <= 8, "only the first take is removed");
});

test("an adjacent stutter keeps only the second occurrence", () => {
  const words = script("Please open the garden gate garden gate and walk inside the long hall.");
  const cands = findRetakeCandidates(words);
  const stutter = cands.find(c => c.kind === "stutter");
  assert.ok(stutter, "stutter found");
  assert.equal(text(words, stutter), "garden gate");
  assert.equal(stutter.end, 5, "the removed words end where the kept copy begins");
});

test("ordinary prose with no repeats gives no candidates", () => {
  const words = script("Every morning the baker walks across the quiet square and opens a heavy blue door.");
  assert.deepEqual(findRetakeCandidates(words), []);
});

test("common function words repeating are not a retake", () => {
  const words = script("It was a gift and it was a surprise that the cat was a friend to all of them.");
  assert.deepEqual(findRetakeCandidates(words), []);
});

test("overlapping candidates form one chain, separate ones stay apart", () => {
  const chains = chainCandidates([
    { start: 0, end: 5, strength: 4, kind: "ngram" },
    { start: 3, end: 9, strength: 4, kind: "ngram" },
    { start: 20, end: 24, strength: 4, kind: "ngram" },
  ]);
  assert.equal(chains.length, 2);
  assert.deepEqual([chains[0].merged.start, chains[0].merged.end], [0, 9]);
  assert.equal(chains[0].members.length, 2);
  assert.equal(chains[1].members.length, 1);
});

test("mergeSpans joins overlapping and touching spans", () => {
  assert.deepEqual(mergeSpans([{ start: 5, end: 8 }, { start: 0, end: 3 }, { start: 3, end: 4 }]), [
    { start: 0, end: 4 },
    { start: 5, end: 8 },
  ]);
});

test("describeCandidate shows the text before, the removed words and the joined result", () => {
  const words = script("one two three four five six seven eight nine ten");
  const d = describeCandidate(words, { start: 3, end: 6 });
  assert.match(d.removed, /four five six/);
  assert.doesNotMatch(d.result, /four/);
  assert.match(d.result, /three/);
  assert.match(d.result, /seven/);
});
