import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadManifest,
  loadPreset,
  HOOK_PRESET_BY_STYLE,
  CAPTION24,
  resolveCaptionPreset,
  leakPreset,
  pickHookEnd,
  hookOpeningText,
  normalizeHookCopy,
  fitSize,
  bindHook,
  frontFallback,
  hasBehindLayer,
  captionWords,
  captionShift,
  leakTimes,
  leakEnvelope,
} from "./hook";
import type { Word } from "./types";

const W = (i: number, text: string, start: number, end: number, emph?: boolean): Word => ({ i, text, start, end, emph });

test("manifest lists loadable presets with credit and a license note", () => {
  const m = loadManifest();
  assert.ok(m.presets.length >= 10);
  for (const e of m.presets) {
    const p = loadPreset(e.id);
    assert.equal(p.kind, e.kind);
    assert.ok(e.credit.includes("24fps"));
    assert.ok(e.page.startsWith("https://24fps.dev/"));
    assert.ok(e.licenseNote.length > 0);
  }
});

test("every hook style maps to a text preset with a behind-subject layer", () => {
  for (const [style, id] of Object.entries(HOOK_PRESET_BY_STYLE)) {
    const p = loadPreset(id);
    assert.equal(p.kind, "text", style);
    assert.ok(hasBehindLayer(p.preset), style);
  }
});

test("engine caption styles resolve to caption presets with karaoke", () => {
  for (const id of Object.keys(CAPTION24)) {
    const p = resolveCaptionPreset(id as any)!;
    assert.ok(p.karaoke && p.font?.family, id);
  }
  assert.equal(resolveCaptionPreset("word_pop"), null);
  assert.equal(leakPreset().type, "light-leak");
});

test("pickHookEnd prefers a sentence end in range, then a beat start, then 3 s", () => {
  const words = [W(0, "Claude", 0, 0.4), W(1, "killed", 0.5, 1), W(2, "editors.", 1.1, 2.9), W(3, "Really", 3.2, 3.6)];
  assert.equal(pickHookEnd(words, [0, 6], 40), Math.round(3.0 * 30) / 30);
  const noEnd = [W(0, "no", 0, 1), W(1, "punctuation", 1, 2), W(2, "here", 2, 3.5)];
  assert.equal(pickHookEnd(noEnd, [0, 3.3, 7], 40), Math.round(3.3 * 30) / 30);
  assert.equal(pickHookEnd(noEnd, [0, 7], 40), 3);
  assert.equal(pickHookEnd(noEnd, [0, 7], 2.6), Math.round(2.1 * 30) / 30);
});

test("hookOpeningText covers words before the hook end", () => {
  const words = [W(0, "Big", 0, 0.5), W(1, "news.", 0.5, 1), W(2, "Later", 5, 6)];
  assert.equal(hookOpeningText(words, 3), "Big news.");
});

test("normalizeHookCopy clamps model output and falls back to the opening", () => {
  const ok = normalizeHookCopy({ word: "stop!", line: "your hook is the only thing that matters today, really." }, "x");
  assert.equal(ok.word, "STOP");
  assert.equal(ok.line.split(" ").length, 7);
  const none = normalizeHookCopy({}, "Claude just killed video editors with Opus.");
  assert.equal(none.word, "EDITORS");
  assert.ok(none.line.startsWith("Claude just killed"));
  assert.equal(normalizeHookCopy({ word: "why?" }, "x").word, "WHY?");
  assert.equal(normalizeHookCopy({ word: "one two three" }, "x").word, "ONE TWO");
});

test("fitSize shrinks long words to one line and keeps short words at the preset size", () => {
  assert.equal(fitSize(0.265, "STOP", "Anton"), 0.265);
  const long = fitSize(0.265, "EVERYTHING", "Anton");
  assert.ok(long < 0.265 && long >= 0.12);
  assert.equal(fitSize(0.265, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Anton"), 0.12);
});

test("bindHook puts the word behind, the line in front, drops fabricated tags, and times it", () => {
  const b = bindHook(HOOK_PRESET_BY_STYLE.giant_word, { word: "OPUS", line: "killed video editors" }, 3.1);
  const layers = b.preset.layers as any[];
  assert.equal(layers.length, 2);
  assert.equal(layers[0].z, "behind-subject");
  assert.equal(layers[0].text, "OPUS");
  assert.equal(layers[1].text, "killed video editors");
  assert.ok(!layers.some(l => /listen up/i.test(l.text)));
  assert.equal(b.preset.duration, 3.1);
  assert.ok(Math.abs(layers[0].out.at + layers[0].out.dur - 3.1) < 1e-6);
  // the manifest preset itself is untouched
  assert.equal((loadPreset(HOOK_PRESET_BY_STYLE.giant_word).preset.layers as any[]).length, 3);
});

test("bindHook on the two-layer ghost preset writes the word into both behind layers", () => {
  const b = bindHook(HOOK_PRESET_BY_STYLE.ghost_topic, { word: "CAMERA", line: "ignored" }, 3);
  const layers = b.preset.layers as any[];
  assert.equal(layers.length, 2);
  assert.ok(layers.every(l => l.text === "CAMERA" && l.z === "behind-subject"));
});

test("frontFallback moves behind layers to the front, above the face", () => {
  const b = bindHook(HOOK_PRESET_BY_STYLE.giant_word, { word: "OPUS", line: "x" }, 3);
  const f = frontFallback(b, 0.2);
  assert.ok(!hasBehindLayer(f.preset));
  const word = (f.preset.layers as any[])[0];
  assert.ok(word.size <= 0.13);
  assert.ok(word.y + word.size * 0.55 <= 0.2, "word stays above the face top");
});

test("captionWords maps timings and emphasis; captionShift moves the band", () => {
  const out = captionWords([W(0, " Hello", 0.1, 0.4), W(1, "world", 0.4, 0.9, true), W(2, " ", 1, 1.1)]);
  assert.deepEqual(out, [
    { w: "Hello", s: 0.1, e: 0.4, emph: false },
    { w: "world", s: 0.4, e: 0.9, emph: true },
  ]);
  assert.equal(captionShift(0.5, 1180), 1180 - 960);
});

test("leakTimes picks layout changes after the hook, spaced, capped", () => {
  const beats = [
    { start: 0, layout: "full" as const },
    { start: 3, layout: "full" as const },
    { start: 5, layout: "split" as const },
    { start: 7, layout: "full" as const },
    { start: 10, layout: "split" as const },
    { start: 20, layout: "full" as const },
    { start: 30, layout: "split" as const },
    { start: 40, layout: "full" as const },
    { start: 50, layout: "split" as const },
  ];
  assert.deepEqual(leakTimes(beats, 3), [5, 10, 20, 30]);
  const flat = beats.map(b => ({ ...b, layout: "full" as const }));
  assert.deepEqual(leakTimes(flat, 3), [5, 20, 30]);
});

test("leakEnvelope rises just before and falls after each time", () => {
  assert.equal(leakEnvelope(0, [5]), 0);
  assert.ok(leakEnvelope(4.96, [5]) > 0 && leakEnvelope(4.96, [5]) < 1);
  assert.equal(leakEnvelope(5, [5]), 1);
  assert.ok(leakEnvelope(5.2, [5]) > 0);
  assert.equal(leakEnvelope(5.4, [5]), 0);
});
