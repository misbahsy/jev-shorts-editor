import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { compareWords, transcribeCleaned } from "./heard";
import { script } from "./testutil";

test("identical word lists, and spelling or punctuation differences, do not differ", () => {
  const a = script("Here are three tips.");
  const b = script("here are 3 tips").map((w, i) => (i === 2 ? { ...w, text: "three" } : w));
  assert.deepEqual(compareWords(a, b), { missing: 0, extra: 0 });
});

test("a word the cuts expected but the clip does not contain is counted as missing, and the reverse as extra", () => {
  const guess = script("this is the real sentence we keep");
  const heard = script("this is real sentence we keep");
  assert.deepEqual(compareWords(guess, heard), { missing: 1, extra: 0 });
  assert.deepEqual(compareWords(heard, guess), { missing: 0, extra: 1 });
  // a caption word heard at the very end that nothing expected
  assert.deepEqual(compareWords(script("a b c"), script("a b c d")), { missing: 0, extra: 1 });
  // a substituted word counts once on each side
  assert.deepEqual(compareWords(script("a b c"), script("a x c")), { missing: 1, extra: 1 });
});

const dir = mkdtempSync(join(tmpdir(), "jev-heard-"));

test("an empty or far shorter transcript of the cleaned clip is refused, so the caller falls back", async () => {
  const guess = script("one two three four five six seven eight nine ten");
  await assert.rejects(transcribeCleaned({ cleanPath: "/nonexistent.mp4", workDir: dir, durationSec: 5, guess, transcribe: async () => [] }), /no words/);
  await assert.rejects(
    transcribeCleaned({ cleanPath: "/nonexistent.mp4", workDir: dir, durationSec: 5, guess, transcribe: async () => script("one two three") }),
    /transcribed to 3 words/,
  );
  await assert.rejects(transcribeCleaned({ cleanPath: "/nonexistent.mp4", workDir: dir, durationSec: 5, guess, transcribe: async () => { throw new Error("parakeet crashed"); } }), /parakeet crashed/);
});
