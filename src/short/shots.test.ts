import { test } from "node:test";
import assert from "node:assert/strict";
import { splitShots, breakQuality, SHOT_MAX_SEC, SHOT_MIN_SEC } from "./shots";
import type { Word } from "./types";

/** Words from text, ~0.28 s each with a small pause after punctuation. */
function speak(text: string, startAt = 0.5): Word[] {
  const out: Word[] = [];
  let t = startAt;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const d = 0.18 + Math.min(tok.length, 9) * 0.03;
    out.push({ i: out.length, text: tok, start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100 });
    t += d + (/[.!?]$/.test(tok) ? 0.3 : /,$/.test(tok) ? 0.15 : 0.02);
  }
  return out;
}

const SCRIPT =
  "Claude just killed video editors with Opus five, and you do not need them anymore. " +
  "Here are three tips for turning Claude into a professional editor. First one is to ask Claude to mimic a video. " +
  "Simply provide a reference video and ask Claude to copy the edits, and then apply them to your own clip. " +
  "Second is to use a prompt that worked for others, which is shared by the community. " +
  "Number three is to use a known framework like hyperframes or remotion, and ask Claude to apply the edits.";

test("shots cover every word exactly once, in order, and never cut a word", () => {
  const words = speak(SCRIPT);
  const shots = splitShots(words);
  assert.equal(shots[0].wordRange[0], 0);
  assert.equal(shots[shots.length - 1].wordRange[1], words.length - 1);
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i].wordRange[0], shots[i - 1].wordRange[1] + 1);
  for (const s of shots) {
    assert.ok(s.wordRange[1] >= s.wordRange[0]);
    // a shot boundary is a word boundary: it starts at a word start
    assert.equal(s.start === 0 || words.some(w => Math.abs(w.start - s.start) < 1e-9), true);
  }
});

test("shots are contiguous and start at zero", () => {
  const shots = splitShots(speak(SCRIPT));
  assert.equal(shots[0].start, 0);
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i].start, shots[i - 1].end);
});

test("shots last about 2 to 3 seconds", () => {
  const words = speak(SCRIPT);
  const shots = splitShots(words);
  assert.ok(shots.length >= 6, `expected many shots, got ${shots.length}`);
  for (const s of shots) {
    const spoken = words[s.wordRange[1]].end - words[s.wordRange[0]].start;
    assert.ok(spoken <= SHOT_MAX_SEC + 0.35, `shot ${s.id} lasts ${spoken}s: ${s.text}`);
  }
  const small = shots.filter(s => words[s.wordRange[1]].end - words[s.wordRange[0]].start < SHOT_MIN_SEC);
  assert.ok(small.length <= 1, `${small.length} shots under ${SHOT_MIN_SEC}s`);
});

test("a shot does not end on a word that needs the next one", () => {
  const words = speak(SCRIPT);
  const shots = splitShots(words);
  const bad = new Set(["the", "a", "to", "of", "and", "your", "with"]);
  for (const s of shots.slice(0, -1)) {
    const last = words[s.wordRange[1]].text.toLowerCase().replace(/[^a-z']/g, "");
    assert.ok(!bad.has(last), `shot ${s.id} ends on "${last}"`);
  }
});

test("sentence ends and commas are preferred cut points", () => {
  const words = speak(SCRIPT);
  const shots = splitShots(words);
  const ends = shots.slice(0, -1).map(s => words[s.wordRange[1]].text);
  const natural = ends.filter(t => /[.,!?]$/.test(t)).length;
  assert.ok(natural >= Math.floor(ends.length / 2), `only ${natural} of ${ends.length} cuts are at punctuation`);
});

test("breakQuality ranks sentence end over comma over plain word", () => {
  const w = speak("one two. three, four five six");
  const sentence = breakQuality(w, 1);
  const comma = breakQuality(w, 2);
  const plain = breakQuality(w, 4);
  assert.ok(sentence > comma && comma > plain);
});

test("a very short clip is one shot and empty input throws", () => {
  const shots = splitShots(speak("hello there"));
  assert.equal(shots.length, 1);
  assert.throws(() => splitShots([]), /no words/);
});
