import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planOverlays, planCameras, allowedCameras, changeEvents, maxChangeGap, planShotTransitions, assembleShots,
  captionSectionsFrom, giantWordFor, GIANT_MIN_GAP_SEC, type ShotContext, type EventShot,
} from "./rhythm";
import { holdMerge, MAX_HOLD_SPLIT_SEC, MAX_HOLD_UNDER_CHIN_SEC } from "./hold";
import type { Beat, BeatDecision, CameraId, Decisions, OverlayId, RawBeat, TemplateId, Word } from "./types";

const dist = (pick: string, extra: Record<string, number> = {}) => ({ [pick]: 0.7, ...extra });

function dec(over: { overlay?: OverlayId; camera?: CameraId; template?: TemplateId; transition?: string; emph?: string | null } = {}): BeatDecision {
  const overlay = over.overlay ?? "none";
  const camera = over.camera ?? "base";
  const template = over.template ?? "big_statement";
  const op: Record<string, number> = { none: 0.1, card: 0.1, keyword_pill: 0.05, giant_word: 0.05, [overlay]: 0.7 };
  return {
    beatId: "x",
    needsVisual: (op.card ?? 0) + (op.keyword_pill ?? 0),
    template: { choice: template, probabilities: dist(template, { versus: 0.2 }), confidence: 0.7 },
    textEffect: { choice: "slide_up", probabilities: dist("slide_up"), confidence: 0.7 },
    transition: { choice: (over.transition ?? "hard_cut") as never, probabilities: dist(over.transition ?? "hard_cut"), confidence: 0.7 },
    punchIn: 0,
    overlay: { choice: overlay, probabilities: op, confidence: 0.7 },
    camera: { choice: camera, probabilities: { base: 0.1, punch: 0.1, face_closeup: 0.1, push_in: 0.1, drift: 0.1, [camera]: 0.6 }, confidence: 0.7 },
    sfx: { choice: "none", probabilities: { none: 1 }, confidence: 0.9 },
    emphasis: over.emph === undefined ? null : over.emph === null ? null : { choice: over.emph, probabilities: { [over.emph]: 1 }, confidence: 0.9 },
  };
}

/** n consecutive 2.5 s shots whose words are w0.. (one word per 0.5 s), for giant-word tests. */
function fixture(n: number): { shots: RawBeat[]; words: Word[] } {
  const words: Word[] = [];
  const shots: RawBeat[] = [];
  const vocab = ["editors", "Claude", "framework", "remotion", "prompt", "timeline", "storyboard", "capcut"];
  for (let s = 0; s < n; s++) {
    const first = words.length;
    for (let k = 0; k < 5; k++) {
      const t = s * 2.5 + k * 0.5;
      words.push({ i: words.length, text: vocab[(s + k) % vocab.length], start: t, end: t + 0.45 });
    }
    shots.push({ id: `b${s}`, start: s * 2.5, end: (s + 1) * 2.5, text: "", wordRange: [first, words.length - 1] });
  }
  return { shots, words };
}

// ---- overlays ----

test("the hook window stays clean: any overlay on a hook shot is removed and logged", () => {
  const { shots, words } = fixture(6);
  const decs = shots.map((_, i) => dec({ overlay: i < 2 ? "card" : "none" }));
  const r = planOverlays(shots, decs, words, 3.2, 15);
  assert.equal(r.overlays.b0, "none");
  assert.equal(r.overlays.b1, "none");
  assert.ok(r.log.some(e => e.shotId === "b0" && /hook/.test(e.rule)));
  assert.ok(r.decisions[0].needsVisual < 0.5);
});

test("giant words are at least GIANT_MIN_GAP_SEC apart; the weaker one is demoted", () => {
  const { shots, words } = fixture(8);
  const decs = shots.map((_, i) => dec({ overlay: i === 2 || i === 3 || i === 7 ? "giant_word" : "none" }));
  // shot 3 is the more confident of the neighbours
  decs[3].overlay!.probabilities.giant_word = 0.9;
  const r = planOverlays(shots, decs, words, 0, 20);
  const kept = Object.keys(r.giants);
  assert.ok(kept.includes("b3"));
  assert.ok(!kept.includes("b2"));
  for (let a = 0; a < kept.length; a++)
    for (let b = a + 1; b < kept.length; b++) {
      const sa = shots.find(s => s.id === kept[a])!;
      const sb = shots.find(s => s.id === kept[b])!;
      assert.ok(Math.abs(sa.start - sb.start) >= GIANT_MIN_GAP_SEC);
    }
  assert.ok(r.log.some(e => e.shotId === "b2" && /apart/.test(e.rule)));
});

test("a giant word never lands right after the hook and needs a plain word", () => {
  const { shots, words } = fixture(6);
  const decs = shots.map((_, i) => dec({ overlay: i === 1 ? "giant_word" : "none" }));
  const r = planOverlays(shots, decs, words, 3.0, 15);
  assert.deepEqual(Object.keys(r.giants), []);
  const bare = [{ i: 0, text: "I", start: 0, end: 0.3 }, { i: 1, text: "do", start: 0.3, end: 0.6 }];
  assert.equal(giantWordFor({ id: "z", start: 0, end: 1, text: "", wordRange: [0, 1] }, dec(), bare), null);
});

test("giant words follow Jev's emphasis pick when it is a plain word", () => {
  const { shots, words } = fixture(3);
  const d = dec({ overlay: "giant_word", emph: "w7" });
  const w = giantWordFor(shots[1], d, words);
  assert.equal(w, words[7].text.toUpperCase());
});

test("card density cap drops the least wanted cards but never opens a long dead run", () => {
  const { shots, words } = fixture(10);
  const decs = shots.map((_, i) => dec({ overlay: "card" }));
  decs[4].overlay!.probabilities.card = 0.3; // least wanted
  const r = planOverlays(shots, decs, words, 0, 25, { coverageCap: 0.55, maxDeadSec: 6 });
  const cards = shots.filter(s => r.overlays[s.id] === "card").length;
  assert.ok(cards / 10 <= 0.6, `cards ${cards}`);
  assert.equal(r.overlays.b4, "none");
  // no stretch longer than maxDeadSec without a card
  let run = 0;
  let worst = 0;
  for (const s of shots) {
    if (r.overlays[s.id] === "none") run += 2.5;
    else run = 0;
    worst = Math.max(worst, run);
  }
  assert.ok(worst <= 6, `dead run ${worst}`);
});

test("a keyword_pill overlay forces the keyword_pill template and a card swaps a pill out", () => {
  const { shots, words } = fixture(2);
  const r1 = planOverlays(shots, [dec({ overlay: "keyword_pill", template: "big_statement" }), dec({ overlay: "card", template: "keyword_pill" })], words, 0, 5, { coverageCap: 1 });
  assert.equal(r1.decisions[0].template.choice, "keyword_pill");
  assert.notEqual(r1.decisions[1].template.choice, "keyword_pill");
});

// ---- cameras ----

const ctx = (id: string, start: number, over: Partial<ShotContext> = {}): ShotContext => ({ id, start, end: start + 2.5, layout: "full", card: false, giant: false, hook: false, ...over });

test("the same camera never plays on two shots in a row", () => {
  const ctxs = Array.from({ length: 8 }, (_, i) => ctx(`b${i}`, i * 2.5));
  const decs = ctxs.map(() => dec({ camera: "punch" })); // Jev wants punch every time
  const r = planCameras(ctxs, decs);
  for (let i = 1; i < r.cameras.length; i++) assert.notEqual(r.cameras[i], r.cameras[i - 1], `shot ${i}`);
  assert.ok(r.log.some(e => /previous shot/.test(e.rule)));
  assert.ok(r.log.every(e => e.from !== e.to));
});

test("hook shots, split shots and giant shots restrict the camera; cards allow only base or punch", () => {
  assert.deepEqual(allowedCameras(ctx("a", 0, { hook: true })).allowed, ["base"]);
  assert.deepEqual(allowedCameras(ctx("a", 0, { layout: "split" })).allowed, ["base"]);
  assert.deepEqual(allowedCameras(ctx("a", 0, { card: true })).allowed, ["base", "punch"]);
  assert.ok(!allowedCameras(ctx("a", 0, { giant: true })).allowed.includes("push_in"));
  assert.ok(allowedCameras(ctx("a", 0)).allowed.includes("drift"));
  const r = planCameras([ctx("a", 0, { hook: true }), ctx("b", 2.5, { card: true })], [dec({ camera: "push_in" }), dec({ camera: "drift" })]);
  assert.deepEqual(r.cameras, ["base", "base"].map((c, i) => (i === 1 ? r.cameras[1] : c)));
  assert.ok(["base", "punch"].includes(r.cameras[1]));
  assert.equal(r.log.length, 2);
});

test("a camera used in the last two shots is down-weighted, so a run varies", () => {
  const ctxs = Array.from({ length: 9 }, (_, i) => ctx(`b${i}`, i * 2.5));
  const decs = ctxs.map((_, i) => dec({ camera: i % 2 === 0 ? "face_closeup" : "punch" }));
  const r = planCameras(ctxs, decs);
  const distinct = new Set(r.cameras);
  assert.ok(distinct.size >= 3, [...distinct].join());
});

test("planCameras is deterministic", () => {
  const ctxs = Array.from({ length: 6 }, (_, i) => ctx(`b${i}`, i * 2.5));
  const decs = ctxs.map((_, i) => dec({ camera: (["punch", "push_in", "drift", "base", "face_closeup", "punch"] as CameraId[])[i] }));
  assert.deepEqual(planCameras(ctxs, decs), planCameras(ctxs, decs));
});

// ---- change events ----

const ev = (start: number, over: Partial<EventShot> = {}): EventShot => ({ start, end: start + 2.5, layout: "full", camera: "base", overlay: "none", cardKey: "", ...over });

test("maxChangeGap finds the longest still stretch and counts cuts as changes", () => {
  const still = [ev(0), ev(2.5), ev(5), ev(7.5)];
  assert.equal(maxChangeGap(still).gapSec, 10);
  assert.equal(maxChangeGap(still, [5]).gapSec, 5);
  const varied = [ev(0), ev(2.5, { camera: "punch" }), ev(5, { camera: "base" }), ev(7.5, { camera: "drift" })];
  assert.ok(maxChangeGap(varied).gapSec <= 3.05);
});

test("a moving camera counts as a change while it moves", () => {
  const e = changeEvents([ev(0, { camera: "push_in", end: 6 })]);
  assert.ok(e.length >= 2);
  assert.ok(maxChangeGap([ev(0, { camera: "push_in", end: 6 })]).gapSec <= 3.05);
});

// ---- transitions ----

test("shot transitions: only where the camera changes, away from cuts, spaced out", () => {
  const sh = [0, 2.5, 5, 7.5, 10, 12.5, 15].map((start, i) => ({ id: `b${i}`, start, firstOfBeat: true, beatTransition: i === 0 ? ("hard_cut" as const) : ("flash" as const), cameraChanged: true }));
  const decs = sh.map(() => dec({ transition: "flash" }));
  const r = planShotTransitions(sh, decs, [10.1]);
  const fx = r.transitions.map((t, i) => (t !== "hard_cut" ? sh[i].start : -1)).filter(t => t >= 0);
  for (let i = 1; i < fx.length; i++) assert.ok(fx[i] - fx[i - 1] >= 5);
  assert.equal(r.transitions[4], "hard_cut"); // a clean cut sits at 10.1
  assert.ok(r.log.length > 0);
  const same = planShotTransitions([{ id: "x", start: 3, firstOfBeat: false, beatTransition: "hard_cut", cameraChanged: false }], [dec({ transition: "flash" })], []);
  assert.equal(same.transitions[0], "hard_cut");
});

// ---- hold ----

test("the hold cap depends on the layout", () => {
  const mk = (tpl: TemplateId, n: number) => {
    const beats: RawBeat[] = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, start: i * 2.5, end: (i + 1) * 2.5, text: "t", wordRange: [i, i] }));
    const decs = beats.map(() => dec({ overlay: "card", template: tpl }));
    return holdMerge(beats, { beats: decs } as unknown as Decisions).beats;
  };
  const under = mk("big_statement", 4); // 10 s of one card wanted
  const split = mk("versus", 4);
  for (const b of under) assert.ok(b.end - b.start <= MAX_HOLD_UNDER_CHIN_SEC + 1e-9);
  for (const b of split) assert.ok(b.end - b.start <= MAX_HOLD_SPLIT_SEC + 2.5); // one shot may exceed by its own length
  assert.ok(under.length < 4, "under-the-chin cards are held across shots");
  assert.equal(split.length, 4, "split cards are swapped each shot");
});

// ---- the whole assembly ----

function beatFor(id: string, start: number, end: number, over: Partial<Beat> = {}): Beat {
  return { id, start, end, text: "", wordRange: [0, 0], layout: "full", visual: null, transitionIn: "hard_cut", punchIn: false, ...over } as Beat;
}

test("assembleShots: cameras alternate, hook is base, overrides land on the shot, gap is reported", () => {
  const { shots, words } = fixture(6);
  const decs = shots.map((_, i) => dec({ overlay: i === 3 ? "giant_word" : "none", camera: "push_in" }));
  const overlay = planOverlays(shots, decs, words, 3, 15);
  assert.deepEqual(Object.keys(overlay.giants), ["b3"]);
  const beats = shots.map((s, i) => beatFor(s.id, s.start, s.end));
  const { shots: out, rhythm } = assembleShots({
    shots, decs: overlay.decisions, beats, overlay, hookEnd: 3, cuts: [], captionSections: [{ start: 0, end: 7.5, style: "word_pop" }, { start: 7.5, end: 15, style: "single_word" }],
  });
  assert.equal(out.length, 6);
  assert.equal(out[0].camera, "base");
  assert.equal(out[1].camera, "base"); // 2.5 < 3 - 0.2 so still in the hook window
  assert.equal(out[3].overlay, "giant_word");
  assert.equal(out[3].giantWord, giantWordFor(shots[3], decs[3], words));
  assert.notEqual(out[3].camera, "push_in"); // a moving camera would slide the giant word
  assert.ok(out[3].overrides.some(o => /giant word/.test(o)));
  for (let i = 2; i < out.length; i++) assert.notEqual(out[i].camera, out[i - 1].camera); // free of the hook, the picture always changes
  assert.equal(out[0].captionStyle, "word_pop");
  assert.equal(out[4].captionStyle, "single_word");
  assert.ok(rhythm.maxGapSec > 0);
  assert.ok(rhythm.overrides.length >= 1);
  assert.deepEqual(out.map(s => s.start), shots.map(s => s.start));
  assert.equal(out[out.length - 1].end, 15);
});

test("assembleShots: a giant word on a split beat is dropped with a reason", () => {
  const { shots, words } = fixture(4);
  const decs = shots.map((_, i) => dec({ overlay: i === 2 ? "giant_word" : "none" }));
  const overlay = planOverlays(shots, decs, words, 0, 10);
  const beats = shots.map((s, i) => beatFor(s.id, s.start, s.end, i === 2 ? { layout: "split" } : {}));
  const { shots: out } = assembleShots({ shots, decs: overlay.decisions, beats, overlay, hookEnd: 0, cuts: [], captionSections: [{ start: 0, end: 10, style: "word_pop" }] });
  assert.equal(out[2].overlay, "none");
  assert.equal(out[2].giantWord, undefined);
  assert.ok(out[2].overrides.some(o => /full-bleed/.test(o)));
});

test("captionSectionsFrom keeps the global style for the first section and covers the whole video", () => {
  const s = captionSectionsFrom(
    [
      { start: 0, end: 13, captionStyle: { choice: "karaoke_line" } },
      { start: 13, end: 30, captionStyle: { choice: "single_word" } },
    ],
    "word_pop",
    32,
  );
  assert.equal(s[0].style, "word_pop");
  assert.equal(s[0].start, 0);
  assert.equal(s[1].style, "single_word");
  assert.equal(s[1].end, 32);
  assert.deepEqual(captionSectionsFrom(undefined, "typewriter_line", 20), [{ start: 0, end: 20, style: "typewriter_line" }]);
});

test("a clip where Jev picks no giant word still gets one per GIANT_TARGET_EVERY_SEC, best supported first", () => {
  const { shots, words } = fixture(12); // 30 s
  const decs = shots.map(() => dec({ overlay: "none" }));
  decs[4].overlay!.probabilities.giant_word = 0.3;
  decs[9].overlay!.probabilities.giant_word = 0.2;
  const r = planOverlays(shots, decs, words, 3, 30);
  // (30 s - 3 s hook) / 14 s target = 1 giant, and b4 is the best supported shot
  assert.deepEqual(Object.keys(r.giants), ["b4"]);
  assert.equal(r.overlays.b4, "giant_word");
  assert.ok(r.log.some(e => e.shotId === "b4" && /promoted/.test(e.rule)));
  // never inside the hook, and never when the cut-out is unavailable
  assert.ok(!Object.keys(planOverlays(shots, decs, words, 3, 30, { allowGiants: false }).giants).length);
});
