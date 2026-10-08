import { test } from "node:test";
import assert from "node:assert/strict";
import { findDrift, findRepeats, norm, parseSilences } from "./verify";

const words = (text: string, start = 0, step = 0.3) =>
  text.split(" ").map((t, i) => ({ i, text: t, start: start + i * step, end: start + i * step + 0.25 }));

test("norm keeps decimals inside numbers and strips outer punctuation", () => {
  assert.equal(norm("5.5."), "5.5");
  assert.equal(norm("“Claude,”"), "claude");
  assert.equal(norm("don’t"), "don't");
});

test("findRepeats flags a restated opener but not topic words shared across the whole short", () => {
  const heard = words(
    "Claude just killed video editors with Opus 5. With Opus 5, you don't need video editors. " +
      "You see this video, it's all edited by Claude. Here are three tips for Claude video. " +
      "First ask Claude to copy a video. Then Claude can cut the video for you.",
  );
  const found = findRepeats(heard);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "restated_sentence");
  assert.deepEqual([...found[0].shared].sort(), ["editors", "opus"]);
});

test("findDrift reports a word chopped by a cut", () => {
  const caption = words("select Opus 5.5 and ask");
  const heard = words("select Opus 5 and ask");
  const drift = findDrift(caption, heard);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].kind, "differs");
  assert.equal(drift[0].caption, "5.5");
  assert.equal(drift[0].heard, "5");
});

test("findDrift separates missing captions from missing audio", () => {
  const drift = findDrift(words("a b c d"), words("a c d e"));
  assert.deepEqual(drift.map((d) => d.kind), ["caption_not_heard", "heard_not_captioned"]);
});

test("parseSilences ignores silence touching either end", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 0",
    "[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.4",
    "[silencedetect @ 0x1] silence_start: 5.2",
    "[silencedetect @ 0x1] silence_end: 5.7 | silence_duration: 0.5",
    "[silencedetect @ 0x1] silence_start: 9.8",
    "[silencedetect @ 0x1] silence_end: 10 | silence_duration: 0.2",
  ].join("\n");
  const p = parseSilences(stderr, 10);
  assert.equal(p.length, 1);
  assert.ok(Math.abs(p[0].sec - 0.5) < 1e-9);
});
