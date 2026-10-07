import test from "node:test";
import assert from "node:assert/strict";
import { confirmRetakes, fallbackAccept, type JevCall } from "./confirm";
import { JEV_CUT_THRESHOLD } from "./constants";
import { script } from "./testutil";

const words = script("one two three four five six seven eight nine ten eleven twelve");
const cands = [
  { start: 0, end: 4, strength: 5, kind: "ngram" as const },
  { start: 6, end: 9, strength: 3, kind: "ngram" as const },
];
const quiet = () => {};
/** A fake Jev reply: score(k) is the noul probability for the k-th question of the batch. */
function reply(questions: Record<string, unknown>, score: (k: number) => number) {
  const answers: Record<string, { type: "noul"; noul: number }> = {};
  Object.keys(questions).forEach((id, k) => (answers[id] = { type: "noul", noul: score(k) }));
  return { response: { answers }, latencyMs: 5 } as never;
}

test("candidates at or above the threshold are cut and carry their score", async () => {
  const call: JevCall = async (_state, questions) => reply(questions, k => (k === 0 ? 0.9 : 0.2));
  const r = await confirmRetakes(words, cands, call, quiet);
  assert.equal(r.mode, "jev");
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].cand.start, 0);
  assert.ok((r.accepted[0].jev ?? 0) >= JEV_CUT_THRESHOLD);
  assert.equal(r.calls, 1);
});

test("one batch carries every question and a single shared state", async () => {
  let seen = 0;
  let states = 0;
  const call: JevCall = async (_s, questions) => {
    states++;
    seen += Object.keys(questions).length;
    return reply(questions, () => 0.1);
  };
  await confirmRetakes(words, cands, call, quiet);
  assert.equal(states, 1);
  assert.equal(seen, 2);
});

test("when Jev throws, only strong candidates are cut and a warning is raised, no crash", async () => {
  const logs: string[] = [];
  const call: JevCall = async () => {
    throw new Error("network down");
  };
  const r = await confirmRetakes(words, cands, call, m => logs.push(m));
  assert.equal(r.mode, "fallback");
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].cand.strength, 5);
  assert.ok(r.warning && logs.some(l => /warning/.test(l)));
});

test("fallback accepts matches of five words or more, and short stutters of three", () => {
  const acc = fallbackAccept([
    { start: 0, end: 3, strength: 4, kind: "ngram" },
    { start: 5, end: 9, strength: 5, kind: "sentence" },
    { start: 10, end: 12, strength: 3, kind: "stutter" },
  ]);
  assert.deepEqual(acc.map(a => a.cand.start), [5, 10]);
});

test("no candidates means no call", async () => {
  let called = false;
  const r = await confirmRetakes(words, [], async () => {
    called = true;
    return {} as never;
  }, quiet);
  assert.equal(called, false);
  assert.equal(r.mode, "none");
});
