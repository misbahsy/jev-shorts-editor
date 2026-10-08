import { test } from "node:test";
import assert from "node:assert/strict";
import { headTopInShot, buildShots, cutTimes, fullCropRect, splitCropRect, moveRect, shotBaseRect, faceSafeZoom, MOVE_RECT_JS, PUNCH_ZOOM, CUT_PUNCH_ZOOM, CLOSEUP_ZOOM, PUSH_ZOOM, DRIFT_ZOOM, FACE_FIT, type CameraMove } from "./framing";
import { buildAudioFilter, shotFilter, moveFilter } from "./render";
import type { ShortPlan } from "./types";

type Spec = { start: number; end: number; layout?: "full" | "split"; punchIn?: boolean };

/** A synthetic plan with only the fields framing and the audio chain read. */
function plan(beats: Spec[], cuts?: number[], extra: Partial<ShortPlan> = {}): ShortPlan {
  return {
    source: { path: "x.mp4", durationSec: 30, width: 1920, height: 1080, fps: 30 },
    output: { width: 1080, height: 1920, fps: 30 },
    perception: { face: { x: 0.45, y: 0.3, w: 0.1, h: 0.2 }, facePerSecond: [], description: "" },
    geometry: {
      full: { crop: { x: 656, y: 0, w: 608, h: 1080 }, face: { x: 400, y: 300, w: 200, h: 200 }, captionY: 900, visualRect: { x: 0, y: 0, w: 1, h: 1 } },
      split: { speaker: { x: 0, y: 840, w: 1080, h: 1080 }, crop: { x: 400, y: 20, w: 964, h: 964 }, panel: { x: 0, y: 0, w: 1080, h: 840 }, face: { x: 0, y: 0, w: 1, h: 1 }, captionY: 1500 },
    },
    words: [],
    beats: beats.map((b, i) => ({
      id: `b${i}`, start: b.start, end: b.end, text: "", wordRange: [0, 0], layout: b.layout ?? "full",
      visual: null, transitionIn: "none", punchIn: b.punchIn ?? false,
    })) as unknown as ShortPlan["beats"],
    sfx: [],
    cuts,
    ...extra,
  } as unknown as ShortPlan;
}

test("with no cuts the shots follow beat.punchIn", () => {
  const shots = buildShots(plan([{ start: 0, end: 5 }, { start: 5, end: 9, punchIn: true }, { start: 9, end: 12 }]));
  assert.deepEqual(shots.map(s => [s.startSec, s.endSec, s.punchIn]), [[0, 5, false], [5, 9, true], [9, 12, false]]);
});

test("a cut inside a beat splits the shot and flips the framing", () => {
  const shots = buildShots(plan([{ start: 0, end: 10 }], [4, 7]));
  assert.deepEqual(shots.map(s => [s.startSec, s.endSec, s.punchIn]), [[0, 4, false], [4, 7, true], [7, 10, false]]);
});

test("a cut on a beat boundary flips even when the next beat is punched in", () => {
  // beat 2's own punchIn is true; without the rule the cut would land on false->true twice and cancel
  const shots = buildShots(plan([{ start: 0, end: 5, punchIn: true }, { start: 5, end: 9, punchIn: true }], [5]));
  assert.deepEqual(shots.map(s => [s.startSec, s.endSec, s.punchIn]), [[0, 5, true], [5, 9, false]]);
});

test("every cut changes the framing", () => {
  const cuts = [2, 5, 8.5, 11];
  const shots = buildShots(plan([{ start: 0, end: 6, punchIn: true }, { start: 6, end: 9 }, { start: 9, end: 14, punchIn: true }], cuts));
  for (const c of cuts) {
    const before = shots.find(s => s.startSec < c && s.endSec >= c - 1e-9);
    const after = shots.find(s => s.startSec <= c + 1e-9 && s.endSec > c + 1e-9);
    assert.ok(before && after, `shots around ${c}`);
    assert.notEqual(before.punchIn, after.punchIn, `framing flips at ${c}`);
  }
});

test("cuts are frame-rounded, sorted and unique", () => {
  assert.deepEqual(cutTimes(plan([], [5.01, 2, 5.0, 0])), [2, 5]);
});

test("shots tile the timeline with no gaps", () => {
  const shots = buildShots(plan([{ start: 0, end: 6 }, { start: 6, end: 9, layout: "split" }, { start: 9, end: 14 }], [3, 6, 12]));
  assert.equal(shots[0].startSec, 0);
  for (let i = 1; i < shots.length; i++) assert.ok(Math.abs(shots[i].startSec - shots[i - 1].endSec) < 1e-9);
  assert.equal(shots[shots.length - 1].endSec, 14);
});

test("the punched crop is smaller, centered on the face and inside the frame", () => {
  const p = plan([{ start: 0, end: 5 }], [2]);
  const base = fullCropRect(p, false);
  const punched = fullCropRect(p, true);
  assert.ok(Math.abs(punched.w - base.w / CUT_PUNCH_ZOOM) <= 1);
  assert.ok(punched.x >= 0 && punched.x + punched.w <= 1920 && punched.y >= 0 && punched.y + punched.h <= 1080);
  const faceCx = (0.45 + 0.05) * 1920;
  assert.ok(faceCx > punched.x && faceCx < punched.x + punched.w);
  const faceTop = 0.3 * 1080;
  const faceBottom = 0.5 * 1080;
  assert.ok(faceTop > punched.y && faceBottom < punched.y + punched.h);
});

test("the split crop keeps its top edge when punched in and follows the face sideways", () => {
  const p = plan([{ start: 0, end: 5, layout: "split" }], [2]);
  // a face right of centre inside the speaker window (output px)
  (p.geometry.split as { face: unknown }).face = { x: 640, y: 1010, w: 240, h: 240 };
  const base = splitCropRect(p, false)!;
  const punched = splitCropRect(p, true)!;
  assert.equal(punched.y, base.y);
  assert.ok(punched.w < base.w);
  assert.ok(punched.x >= base.x && punched.x + punched.w <= base.x + base.w, "stays inside the base crop");
  // the face centre (760 of 1080) sits at 0.70 of the base crop; the zoomed window slides toward it
  assert.ok(punched.x + punched.w / 2 > base.x + base.w / 2);
  // a centred face keeps the window centred
  (p.geometry.split as { face: unknown }).face = { x: 420, y: 1010, w: 240, h: 240 };
  const centred = splitCropRect(p, true)!;
  assert.ok(Math.abs(centred.x + centred.w / 2 - (base.x + base.w / 2)) <= 1);
});

test("audio: --no-clean plans keep the original chain, clean plans get highpass and loudnorm", () => {
  const assets = { whoosh: "w.mp3", pop: "p.mp3", ding: "d.mp3", riser: "r.mp3", impact: "i.mp3" };
  const old = buildAudioFilter(plan([{ start: 0, end: 5 }]), assets, 2).filter;
  assert.equal(old, "[0:a]alimiter=limit=0.95:attack=5:release=50[aout]");

  const m = { inputI: -24.18, inputTP: -4.75, inputLRA: 3.1, inputThresh: -34.9, targetOffset: 0.52 };
  const p = plan([{ start: 0, end: 5 }], [2], { loudness: m, sfx: [{ type: "pop", at: 1.5, gainDb: -12 }] });
  const { filter, sfxFiles } = buildAudioFilter(p, assets, 2);
  assert.deepEqual(sfxFiles, ["p.mp3"]);
  assert.match(filter, /\[0:a\]highpass=f=80\[voice\]/);
  assert.match(filter, /amix=inputs=2:duration=first:normalize=0\[amixed\]/);
  assert.match(filter, /measured_I=-24\.18:measured_TP=-4\.75:measured_LRA=3\.10:measured_thresh=-34\.90:offset=0\.52:linear=true/);
  assert.equal((filter.match(/loudnorm=/g) ?? []).length, 1, "loudnorm runs once");
  assert.match(filter, /alimiter=limit=0\.89/);
});

// ---------------- per-shot cameras (plan.shots) ----------------

type ShotSpec = { start: number; end: number; camera: string; layout?: "full" | "split" };
function planWithShots(shots: ShotSpec[], cuts?: number[]): ShortPlan {
  const p = plan([{ start: shots[0].start, end: shots[shots.length - 1].end }], cuts);
  (p as unknown as { shots: unknown }).shots = shots.map((s, i) => ({ id: `b${i}`, layout: "full", ...s }));
  return p;
}

test("plan.shots drive the cameras: static, closeup and moving", () => {
  const shots = buildShots(planWithShots([
    { start: 0, end: 3, camera: "base" },
    { start: 3, end: 6, camera: "face_closeup" },
    { start: 6, end: 9, camera: "push_in" },
    { start: 9, end: 12, camera: "drift" },
  ]));
  assert.deepEqual(shots.map(s => s.camera), ["base", "face_closeup", "push_in", "drift"]);
  assert.equal(shots[1].zoom, CLOSEUP_ZOOM);
  assert.equal(shots[1].move, null);
  assert.ok(shots[2].move && shots[2].move.z1 > shots[2].move.z0);
  assert.ok(shots[3].move && shots[3].move.ax1 > shots[3].move.ax0, "drift glides sideways");
  assert.ok(shots[0].zoom === 1 && !shots[0].punchIn);
});

test("moving shots are never merged and static equal neighbours are", () => {
  const shots = buildShots(planWithShots([
    { start: 0, end: 3, camera: "base" },
    { start: 3, end: 6, camera: "base" },
    { start: 6, end: 9, camera: "push_in" },
    { start: 9, end: 12, camera: "push_in" },
  ]));
  assert.deepEqual(shots.map(s => [s.startSec, s.endSec]), [[0, 6], [6, 9], [9, 12]]);
});

test("a cut inside a moving shot restarts the move and flips when the join would not read", () => {
  const shots = buildShots(planWithShots([{ start: 0, end: 6, camera: "base" }, { start: 6, end: 12, camera: "push_in" }], [9]));
  const moving = shots.filter(s => s.startSec >= 6);
  assert.equal(moving.length, 2);
  assert.ok(moving[0].move, "first piece keeps the push");
  // the first piece ends at 1.1x; the piece after the cut starts at 1.0x, a visible change already, so no flip
  assert.ok(moving[1].move && moving[1].move.z0 === PUSH_ZOOM[0]);
  assert.equal(moving[1].startSec, 9);
});

test("a cut flips a base shot, never a camera Jev chose", () => {
  // Jev said base, base: the cut after the first piece must still read, so the second piece punches in
  const b = buildShots(planWithShots([{ start: 0, end: 4, camera: "base" }, { start: 4, end: 8, camera: "base" }], [4]));
  assert.deepEqual(b.map(s => s.camera), ["base", "punch"]);
  // Jev said punch, punch: the render keeps both (one merged shot), the cut is Jev's to leave alone
  const p = buildShots(planWithShots([{ start: 0, end: 4, camera: "punch" }, { start: 4, end: 8, camera: "punch" }], [4]));
  assert.deepEqual(p.map(s => s.camera), ["punch"]);
  // base after a punch already differs at the join, so it is left as base
  const a = buildShots(planWithShots([{ start: 0, end: 4, camera: "punch" }, { start: 4, end: 8, camera: "base" }], [4]));
  assert.deepEqual(a.map(s => s.camera), ["punch", "base"]);
  // a base piece that follows a zoomed-in end flips back to base, not to another punch
  const c = buildShots(planWithShots([{ start: 0, end: 4, camera: "face_closeup" }, { start: 4, end: 8, camera: "base" }], [4]));
  assert.deepEqual(c.map(s => s.camera), ["face_closeup", "base"]);
});

test("every camera Jev picks is the camera that renders, on the full layout", () => {
  const cams = ["base", "punch", "face_closeup", "push_in", "drift", "punch", "base"];
  const shots = buildShots(planWithShots(cams.map((camera, i) => ({ start: i * 3, end: i * 3 + 3, camera }))));
  assert.deepEqual(shots.map(s => s.camera), cams);
});

test("punch is clearly stronger than before and the close-up is tighter than punch", () => {
  assert.ok(PUNCH_ZOOM >= 1.25 && PUNCH_ZOOM <= 1.3, `punch ${PUNCH_ZOOM}`);
  assert.ok(CLOSEUP_ZOOM >= PUNCH_ZOOM + 0.15, `closeup ${CLOSEUP_ZOOM}`);
  const [punch, close] = buildShots(planWithShots([{ start: 0, end: 3, camera: "punch" }, { start: 3, end: 6, camera: "face_closeup" }]));
  assert.ok(punch.zoom >= 1.25);
  assert.ok(close.zoom > punch.zoom);
  assert.ok(fullCropRect(planWithShots([{ start: 0, end: 3, camera: "punch" }]), close.zoom).w < fullCropRect(planWithShots([{ start: 0, end: 3, camera: "punch" }]), punch.zoom).w);
});

test("faceSafeZoom caps a zoom so the face keeps FACE_FIT of room, on both layouts", () => {
  const p = plan([{ start: 0, end: 5 }]);
  // full: face 192 x 216 source px in a 608 x 1080 crop -> a 5x zoom would crop it, so it is capped
  const full = faceSafeZoom(p, "full", 5);
  assert.ok(full < 5 && full > 1);
  assert.ok(192 * FACE_FIT * full <= 608 + 1e-6 && 216 * FACE_FIT * full <= 1080 + 1e-6);
  assert.equal(faceSafeZoom(p, "full", 1.1), 1.1, "a small zoom is untouched");
  // split: a 240 px face in a 1080 px speaker window
  (p.geometry.split as { face: unknown }).face = { x: 420, y: 1010, w: 240, h: 240 };
  const split = faceSafeZoom(p, "split", 9);
  assert.ok(split < 9 && split >= 1);
  assert.ok(240 * FACE_FIT * split <= 1080 + 1e-6);
  // no detected face: nothing to protect, nothing capped
  const bare = plan([{ start: 0, end: 5 }]);
  (bare.geometry.full as { face: unknown }).face = { x: 0, y: 0, w: 0, h: 0 };
  assert.equal(faceSafeZoom(bare, "full", 2.5), 2.5);
});

test("every zoom keeps the face inside the view (full layout)", () => {
  const p = planWithShots([
    { start: 0, end: 3, camera: "punch" }, { start: 3, end: 6, camera: "face_closeup" },
    { start: 6, end: 9, camera: "push_in" }, { start: 9, end: 12, camera: "drift" },
  ]);
  const f = p.perception.face;
  const fx = f.x * 1920, fy = f.y * 1080, fw = f.w * 1920, fh = f.h * 1080;
  for (const shot of buildShots(p)) {
    for (const prog of shot.move ? [0, 0.5, 1] : [0]) {
      const r = shot.move ? moveRect(p.geometry.full.crop, shot.move, prog) : shotBaseRect(p, shot)!;
      // the drift glides sideways by design; the face may touch a side but must be inside the view then too
      assert.ok(fy >= r.y && fy + fh <= r.y + r.h, `${shot.camera}@${prog} face top/bottom inside`);
      assert.ok(fx + fw / 2 >= r.x && fx + fw / 2 <= r.x + r.w, `${shot.camera}@${prog} face centre inside`);
    }
  }
});

test("split layouts honour face_closeup, punch, push_in and drift", () => {
  const split = (camera: string, start: number) => ({ start, end: start + 3, camera, layout: "split" as const });
  const p = planWithShots([split("push_in", 0), split("face_closeup", 3), split("drift", 6), split("punch", 9), split("base", 12)]);
  const shots = buildShots(p);
  assert.deepEqual(shots.map(s => s.camera), ["push_in", "face_closeup", "drift", "punch", "base"]);
  assert.ok(shots[0].move && shots[0].move.z1 > shots[0].move.z0);
  assert.ok(shots[0].move!.ay0 === 0 && shots[0].move!.ay1 === 0, "the split zoom holds the top edge");
  assert.ok(shots[2].move && shots[2].move.ax1 > shots[2].move.ax0, "drift glides sideways");
  assert.equal(shots[1].move, null);
  assert.ok(shots[1].zoom > shots[3].zoom && shots[3].zoom >= 1.2, "closeup tighter than punch");
  assert.equal(shots[4].zoom, 1);
  // static zooms crop a smaller window of the split crop; moving ones cut from the whole crop
  const base = (p.geometry.split as { crop: { w: number } }).crop;
  assert.ok(shotBaseRect(p, shots[1])!.w < shotBaseRect(p, shots[3])!.w);
  assert.ok(shotBaseRect(p, shots[3])!.w < base.w);
  assert.deepEqual(shotBaseRect(p, shots[0]), (p.geometry.split as { crop: unknown }).crop);
  assert.ok(Math.abs(DRIFT_ZOOM[1] - PUSH_ZOOM[1]) < 0.1);
});

test("a split layout with no geometry crop stays a bare base shot", () => {
  const p = planWithShots([{ start: 0, end: 3, camera: "push_in", layout: "split" }, { start: 3, end: 6, camera: "face_closeup", layout: "split" }]);
  delete (p.geometry.split as { crop?: unknown }).crop;
  const shots = buildShots(p);
  assert.ok(shots.every(s => s.move === null && s.camera === "base" && s.zoom === 1));
});

test("the ffmpeg filter for a moving split camera scales per frame, crops 1080 square and pads under the panel", () => {
  const p = planWithShots([{ start: 2, end: 5, camera: "push_in", layout: "split" }]);
  const [shot] = buildShots(p);
  const f = shotFilter(shot, p, 0);
  assert.match(f, /eval=frame/);
  assert.match(f, /crop=1080:1080:x='/);
  assert.match(f, /pad=1080:1920:0:840:0x0b0b0f\[/);
});

test("moveRect holds the anchor point fixed on screen while the zoom grows", () => {
  const base = { x: 100, y: 0, w: 600, h: 1000 };
  const move: CameraMove = { z0: 1, z1: 1.2, ax0: 0.4, ax1: 0.4, ay0: 0.3, ay1: 0.3 };
  for (const p of [0, 0.25, 0.5, 1]) {
    const r = moveRect(base, move, p);
    // the anchor's source point sits at the same fraction of the view at every progress
    assert.ok(Math.abs((base.x + 0.4 * base.w - r.x) / r.w - 0.4) < 1e-9);
    assert.ok(Math.abs((base.y + 0.3 * base.h - r.y) / r.h - 0.3) < 1e-9);
  }
  assert.deepEqual(moveRect(base, move, 0), base);
  assert.ok(Math.abs(moveRect(base, move, 1).w - 500) < 1e-9);
  assert.deepEqual(moveRect(base, move, 5), moveRect(base, move, 1), "progress clamps");
});

test("the preview's JS copy of moveRect gives the same numbers", () => {
  const js = new Function(`${MOVE_RECT_JS}; return moveRect;`)() as typeof moveRect;
  const base = { x: 656, y: 0, w: 608, h: 1080 };
  const move: CameraMove = { z0: 1.06, z1: 1.11, ax0: 0.3, ax1: 0.7, ay0: 0.38, ay1: 0.38 };
  for (const p of [-1, 0, 0.1, 0.5, 0.99, 1, 2]) assert.deepEqual(js(base, move, p), moveRect(base, move, p));
});

test("the ffmpeg filter for a moving camera scales per frame and crops the output window", () => {
  const p = planWithShots([{ start: 2, end: 5, camera: "push_in" }]);
  const [shot] = buildShots(p);
  const f = moveFilter(p, shot);
  assert.match(f, /^crop=608:1080:656:0,scale=w='[^']+':h='[^']+':eval=frame/);
  assert.ok(f.includes("clip(t/3,0,1)"), "progress is shot-local time over the shot duration");
  assert.match(f, /crop=1080:1920:x='/);
  assert.ok(shotFilter(shot, p, 0).startsWith("[0:v]trim=start=2:end=5,setpts=PTS-STARTPTS,crop=608:1080"));
  // static cameras stay a plain crop and scale
  const [base] = buildShots(planWithShots([{ start: 0, end: 3, camera: "base" }]));
  assert.ok(!shotFilter(base, p, 0).includes("eval=frame"));
});

test("plans without plan.shots still frame from beat.punchIn", () => {
  const [a, b] = buildShots(plan([{ start: 0, end: 4 }, { start: 4, end: 8, punchIn: true }]));
  assert.equal(a.camera, "base");
  assert.equal(b.camera, "punch");
});

test("headTopInShot: a close-up re-frames the hair and stays on screen", () => {
  const p = plan([{ start: 0, end: 4 }]);
  const base = buildShots(p)[0];
  const close = { ...base, zoom: CLOSEUP_ZOOM, move: null };
  const a = headTopInShot(p, { ...base, zoom: 1, move: null });
  const b = headTopInShot(p, close);
  assert.ok(a !== null && b !== null);
  assert.notEqual(a, b, "a different camera places the hair differently");
  assert.ok(a! >= 0.04 && a! <= 0.5 && b! >= 0.04 && b! <= 0.5);
  // no detected face, no answer
  const noFace = { ...p, geometry: { ...p.geometry, full: { ...p.geometry.full, face: { x: 0, y: 0, w: 0, h: 0 } } } } as ShortPlan;
  assert.equal(headTopInShot(noFace, base), null);
});
