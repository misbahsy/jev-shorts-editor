import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyHookStructure, buildHookPlan, leakEnvelope, hasBehindLayer, headTopFromFace, placeBehindHead, bindHook } from "./hook";
import { judgeCoverage, hookWindowFilter } from "./matte";
import { buildPrompt } from "./copy";
import { inlineEngine, fontFaceCss, film24Config } from "./film/buildFilm";
import type { BeatStructure } from "./structure";
import type { BeatDecision, ShortPlan, Word } from "./types";

const st = (id: string, over: Partial<BeatStructure> = {}): BeatStructure => ({
  beatId: id, hasVisual: true, template: "big_statement", layout: "full", textEffect: "word_pop",
  transition: "flash", transitionIn: "flash", punchIn: true, ...over,
});
const dec = (id: string): BeatDecision => ({
  beatId: id, needsVisual: 0.9,
  template: { choice: "versus", probabilities: { versus: 0.6, big_statement: 0.3, stamp: 0.1 }, confidence: 0.6 },
  textEffect: { choice: "word_pop", probabilities: {}, confidence: 0.5 },
  transition: { choice: "flash", probabilities: {}, confidence: 0.5 },
  punchIn: 0.9, sfx: { choice: "pop", probabilities: {}, confidence: 0.5 }, emphasis: null,
});

test("applyHookStructure: hook beats are full, no punch-in, hard cut; short beats lose the card; straddler gets visualFrom", () => {
  const beats = [
    { id: "a", start: 0, end: 1.0 },
    { id: "b", start: 1.0, end: 2.0 },
    { id: "c", start: 2.0, end: 5.0 },
    { id: "d", start: 5.0, end: 8.0 },
  ];
  const structure = [st("a"), st("b", { layout: "split", template: "versus" }), st("c"), st("d", { layout: "split", template: "versus", transitionIn: "glass_wipe" })];
  const out = applyHookStructure(structure, beats, beats.map(b => dec(b.id)), 3.0);
  assert.equal(out.structure[0].hasVisual, false);
  assert.equal(out.structure[0].template, null);
  assert.equal(out.structure[1].layout, "full");
  assert.notEqual(out.structure[1].template, "versus");
  assert.ok(out.structure.slice(0, 3).every(s => !s.punchIn && s.transitionIn === "hard_cut"));
  assert.equal(out.visualFrom.c, 3.0);
  assert.equal(out.visualFrom.a, undefined);
  // beats after the hook are untouched, and the input is not mutated
  assert.equal(out.structure[3].transitionIn, "glass_wipe");
  assert.equal(structure[0].hasVisual, true);
});

test("buildHookPlan: cut-out keeps behind layers; failure falls back to the front and records why", () => {
  const args = { style: "giant_word" as const, copy: { word: "STOP", line: "Do not edit like this" }, opening: "Stop editing like this", endSec: 3, faceTopFrac: 0.2 };
  const ok = buildHookPlan({ ...args, cutout: { ok: true, frames: 90 } });
  assert.equal(ok.cutout, true);
  assert.equal(ok.fgFrames, 90);
  assert.ok(hasBehindLayer(ok.preset));
  assert.equal(ok.fallbackReason, undefined);
  assert.equal(ok.word, "STOP");

  const bad = buildHookPlan({ ...args, cutout: { ok: false, frames: 0, reason: "no person" } });
  assert.equal(bad.cutout, false);
  assert.equal(bad.fgFrames, 0);
  assert.ok(!hasBehindLayer(bad.preset));
  assert.equal(bad.fallbackReason, "no person");
});

test("judgeCoverage accepts a steady matte and rejects an empty or patchy one", () => {
  const f = (cov: number[]) => cov.map((coverage, i) => ({ file: `${i}.png`, coverage }));
  assert.equal(judgeCoverage(f([])).ok, false);
  assert.equal(judgeCoverage(f(new Array(30).fill(0.32))).ok, true);
  assert.equal(judgeCoverage(f(new Array(30).fill(0.01))).ok, false);
  const patchy = f([...new Array(20).fill(0.3), ...new Array(10).fill(0)]);
  assert.equal(judgeCoverage(patchy).ok, false);
});

test("hookWindowFilter concatenates only the shots inside the hook, clipped to hookEnd", () => {
  const plan = {
    source: { path: "x.mp4", durationSec: 30, width: 1920, height: 1080, fps: 30 },
    output: { width: 1080, height: 1920, fps: 30 },
    perception: { face: { x: 0.45, y: 0.3, w: 0.1, h: 0.2 }, facePerSecond: [], description: "" },
    geometry: {
      full: { crop: { x: 656, y: 0, w: 608, h: 1080 }, face: { x: 400, y: 300, w: 200, h: 200 }, captionY: 900, visualRect: { x: 0, y: 0, w: 1, h: 1 } },
      split: { speaker: { x: 0, y: 840, w: 1080, h: 1080 }, crop: { x: 400, y: 20, w: 964, h: 964 }, panel: { x: 0, y: 0, w: 1080, h: 840 }, face: { x: 0, y: 0, w: 1, h: 1 }, captionY: 1500 },
    },
    words: [], sfx: [],
    beats: [
      { id: "a", start: 0, end: 2, layout: "full", punchIn: false },
      { id: "b", start: 2, end: 6, layout: "full", punchIn: true },
      { id: "c", start: 6, end: 9, layout: "full", punchIn: false },
    ],
  } as unknown as ShortPlan;
  const { filter, label } = hookWindowFilter(plan, 3);
  assert.equal(label, "hookv");
  assert.match(filter, /concat=n=2:v=1:a=0\[hookv\]/);
  assert.ok(!filter.includes("s2"));
});

test("buildPrompt asks for the hook word only when a hook is requested", () => {
  const beats = [{ id: "a", start: 0, end: 2, text: "Stop doing this", wordRange: [0, 2] as [number, number] }];
  const words: Word[] = [{ i: 0, text: "Stop", start: 0, end: 0.5 }];
  const without = buildPrompt(beats, [st("a")], words, { title: "t" });
  const withHook = buildPrompt(beats, [st("a")], words, { title: "t" }, { opening: "Stop doing this", style: "giant_word" });
  assert.ok(!without.includes("OPENING HOOK"));
  assert.ok(withHook.includes("OPENING HOOK"));
  assert.ok(withHook.includes('"hook"'));
});

test("inlineEngine is a classic script exposing Film24 with a network-free loadFonts", () => {
  const js = inlineEngine();
  assert.ok(js.startsWith("window.Film24 = (function"));
  assert.ok(!/^\s*export\s/m.test(js));
  assert.ok(!js.includes("fonts.googleapis.com/css2?") || js.indexOf("document.fonts.load") < js.indexOf("fonts.googleapis.com/css2?"));
  // the early return sits before the stylesheet branch
  const fn = js.slice(js.indexOf("function loadFonts"));
  assert.ok(fn.indexOf("return fontsPending;") < fn.indexOf("createElement(\"link\")"));
  new Function(js); // parses
});

test("fontFaceCss embeds exactly the fonts the presets use", () => {
  const css = fontFaceCss([{ layers: [{ font: { family: "Anton", weight: 400 } }, { font: { family: "Inter", weight: 800 } }] }]);
  assert.equal(css.match(/@font-face/g)?.length, 2);
  assert.ok(css.includes('font-family:"Anton"'));
  assert.ok(css.includes("data:font/woff2;base64,"));
  assert.throws(() => fontFaceCss([{ font: { family: "Comic Sans", weight: 400 } }]));
});

test("film24Config resolves engine captions only for engine styles, and leaks only when planned", () => {
  const base = { words: [{ i: 0, text: "hi", start: 0, end: 1, emph: true }], style: { captionStyle: "anton_karaoke" }, fx: { leaks: [5] } };
  const a = film24Config(base);
  assert.equal(a.caption?.karaoke, "color");
  assert.deepEqual(a.captionWords, [{ w: "hi", s: 0, e: 1, emph: true }]);
  assert.equal(a.leak?.type, "light-leak");
  const b = film24Config({ ...base, style: { captionStyle: "word_pop" }, fx: { leaks: [] } });
  assert.equal(b.caption, null);
  assert.equal(b.captionWords, null);
  assert.equal(b.leak, null);
});

test("hook24.js leakEnvelope matches hook.ts", () => {
  const src = readFileSync(resolve(import.meta.dirname, "film", "hook24.js"), "utf8");
  const m = src.match(/function leakEnvelope[\s\S]*?\n  }\n/);
  assert.ok(m);
  const js = new Function(`${m![0]}; return leakEnvelope;`)() as (t: number, times: number[]) => number;
  for (const t of [0, 4.9, 4.96, 5, 5.1, 5.34, 5.4, 9]) {
    assert.ok(Math.abs(js(t, [5]) - leakEnvelope(t, [5])) < 0.001, `t=${t}`);
  }
});

test("placeBehindHead lifts the giant word to the top of the head, under the top UI band; small ghost layers stay", () => {
  assert.equal(headTopFromFace({ y: 383, h: 687 }), (383 - 0.25 * 687) / 1920);
  const bound = bindHook("giant-word-behind-head", { word: "KILLED", line: "x" }, 3);
  const moved = placeBehindHead(bound, 0.106);
  const l = (moved.preset.layers as any[]).find(x => x.z === "behind-subject");
  assert.ok(l.y < 0.2 && l.y >= 0.055 + (l.size * 0.78) / 2 - 1e-9);
  const ghost = bindHook("giant-white-word-top-cropped-behind", { word: "CAMERA", line: "" }, 3);
  const g = placeBehindHead(ghost, 0.3);
  assert.deepEqual((g.preset.layers as any[]).map(x => x.y), (ghost.preset.layers as any[]).map(x => x.y));
  const hp = buildHookPlan({ style: "giant_word", copy: { word: "STOP", line: "a" }, opening: "stop", endSec: 3, cutout: { ok: true, frames: 90 }, faceTopFrac: 0.2, headTopFrac: 0.106 });
  assert.ok((hp.preset.layers as any[])[0].y < 0.2);
});
