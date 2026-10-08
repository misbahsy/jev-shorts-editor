/**
 * Framing shared by render.ts (ffmpeg crop) and preview.ts (CSS crop): which crop rect is on screen
 * at each moment. Two things change the framing:
 *   - beat.punchIn, the pipeline's own emphasis zoom (full layout only), and
 *   - the clean stage's cuts. Every visible cut flips between the normal and a punched-in crop, so
 *     a jump cut reads as a deliberate camera change instead of a glitch.
 * The shot list is computed once here and the preview receives it as data, so the two can never
 * disagree about where a cut is or which way it flips.
 */
import type { CameraId, ShortPlan, Rect } from "./types";

/** Zoom of a plain beat punch-in (plans made without the clean stage keep this). */
export const BEAT_PUNCH_ZOOM = 1.1;
/** Zoom of the punched-in framing when the plan has cuts. */
export const CUT_PUNCH_ZOOM = 1.12;

const FPS = 30;
const round30 = (t: number) => Math.round(t * FPS) / FPS;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zoom of a tight face close-up (static). */
export const CLOSEUP_ZOOM = 1.22;
/** Slow push-in: zoom at the start and end of the shot, anchored on the face. */
export const PUSH_ZOOM: [number, number] = [1.0, 1.1];
/** Slow drift: a gentle zoom while the anchor glides sideways across the frame. */
export const DRIFT_ZOOM: [number, number] = [1.06, 1.11];
export const DRIFT_ANCHOR_X: [number, number] = [0.3, 0.7];
/** Two framings count as different (for the cut flip) when their zoom differs by at least this much. */
const FLIP_GAP = 0.06;

/**
 * A camera move inside one shot. The view is the base crop zoomed by Z(p) = z0 + (z1 - z0) * p,
 * p = elapsed / duration clamped to [0, 1], with the point (ax, ay) (fractions of the base crop)
 * held fixed on screen, so the zoom grows toward that point. Both ffmpeg and the preview evaluate
 * exactly this, see {@link moveRect}.
 */
export interface CameraMove {
  z0: number;
  z1: number;
  ax0: number;
  ax1: number;
  ay0: number;
  ay1: number;
}

export interface Shot {
  startSec: number;
  endSec: number;
  layout: "full" | "split";
  /** true = a statically zoomed-in framing for this layout (punch, close-up, or a cut flip). */
  punchIn: boolean;
  /** The camera treatment of this stretch, after the cut flip. */
  camera: CameraId;
  /** Static zoom factor (1 = base framing). Ignored when `move` is set. */
  zoom: number;
  /** Set for push_in and drift on the full layout. */
  move: CameraMove | null;
}

export function punchZoom(plan: ShortPlan): number {
  return plan.cuts && plan.cuts.length > 0 ? CUT_PUNCH_ZOOM : BEAT_PUNCH_ZOOM;
}

/** Plan cuts on the 30 fps grid, sorted, de-duplicated. */
export function cutTimes(plan: ShortPlan): number[] {
  const out = [...new Set((plan.cuts ?? []).map(round30))].filter(t => t > 0).sort((a, b) => a - b);
  return out;
}

/** Face centre as fractions of the full base crop, clamped so the zoom never anchors on an edge. */
function faceAnchor(plan: ShortPlan): { ax: number; ay: number } {
  const base = plan.geometry.full.crop;
  const detected = plan.geometry.full.face.w > 0 && plan.geometry.full.face.h > 0;
  if (!detected || base.w <= 0 || base.h <= 0) return { ax: 0.5, ay: 0.4 };
  const cx = (plan.perception.face.x + plan.perception.face.w / 2) * plan.source.width;
  const cy = (plan.perception.face.y + plan.perception.face.h / 2) * plan.source.height;
  return {
    ax: clamp((cx - base.x) / base.w, 0.25, 0.75),
    ay: clamp((cy - base.y) / base.h, 0.15, 0.6),
  };
}

function moveFor(plan: ShortPlan, camera: CameraId): CameraMove | null {
  const { ax, ay } = faceAnchor(plan);
  if (camera === "push_in") return { z0: PUSH_ZOOM[0], z1: PUSH_ZOOM[1], ax0: ax, ax1: ax, ay0: ay, ay1: ay };
  if (camera === "drift") return { z0: DRIFT_ZOOM[0], z1: DRIFT_ZOOM[1], ax0: DRIFT_ANCHOR_X[0], ax1: DRIFT_ANCHOR_X[1], ay0: ay, ay1: ay };
  return null;
}

/** Zoom at the start and the end of a stretch with this camera (the cut flip compares them). */
function zoomRange(camera: CameraId, plan: ShortPlan, animates: boolean): [number, number] {
  if (camera === "punch") return [punchZoom(plan), punchZoom(plan)];
  if (camera === "face_closeup") return [CLOSEUP_ZOOM, CLOSEUP_ZOOM];
  if (camera === "push_in" && animates) return PUSH_ZOOM;
  if (camera === "drift" && animates) return DRIFT_ZOOM;
  return [1, 1];
}

interface Segment {
  start: number;
  end: number;
  layout: "full" | "split";
  camera: CameraId;
}

/** The per-stretch cameras: plan.shots when the plan has them, else one per beat from beat.punchIn. */
function segmentsOf(plan: ShortPlan): Segment[] {
  const out: Segment[] = [];
  if (plan.shots && plan.shots.length > 0) {
    for (const s of plan.shots) out.push({ start: round30(s.start), end: round30(s.end), layout: s.layout, camera: s.camera });
  } else {
    for (const b of plan.beats) {
      out.push({ start: round30(b.start), end: round30(b.end), layout: b.layout, camera: b.layout === "full" && b.punchIn ? "punch" : "base" });
    }
  }
  return out.filter(s => s.end > s.start + 1e-6);
}

/**
 * Splits the plan into shots, a stretch with one layout and one camera treatment. A shot starts
 * from the camera its plan.shots entry names (or beat.punchIn for plans made before shots existed)
 * and is cut at each of the clean stage's cuts. Every cut must read as a deliberate camera change,
 * so a piece that starts at a cut and would look like the piece before it (zoom within FLIP_GAP at
 * the join) is flipped: a zoomed-in end is followed by the base framing, anything else by a punch.
 * Moving cameras restart at each cut and run across their own piece. Adjacent static pieces with
 * the same layout and camera are merged into one shot.
 */
export function buildShots(plan: ShortPlan): Shot[] {
  const cuts = cutTimes(plan);
  const shots: Shot[] = [];
  let prevEnd = 1; // zoom the previous piece ended with
  const push = (start: number, end: number, layout: "full" | "split", camera: CameraId) => {
    // split never animates; a moving camera there is plain base
    let cam: CameraId = layout === "split" && (camera === "push_in" || camera === "drift") ? "base" : camera;
    // the camera is applied to the layout: only full has the other treatments, split has base and punch
    if (layout === "split" && cam === "face_closeup") cam = "punch";
    const animates = layout === "full" && (cam === "push_in" || cam === "drift");
    const [z0, z1] = zoomRange(cam, plan, animates);
    const move = animates ? moveFor(plan, cam) : null;
    const zoom = animates ? 1 : z0;
    const last = shots[shots.length - 1];
    if (!move && last && !last.move && last.layout === layout && last.camera === cam && Math.abs(last.endSec - start) < 1e-6) {
      last.endSec = end;
    } else {
      shots.push({ startSec: start, endSec: end, layout, camera: cam, zoom, move, punchIn: !move && zoom > 1 });
    }
    prevEnd = move ? z1 : zoom;
  };
  const flipped = (camera: CameraId, layout: "full" | "split"): CameraId => {
    const animates = layout === "full" && (camera === "push_in" || camera === "drift");
    const [z0] = zoomRange(camera, plan, animates);
    if (Math.abs(z0 - prevEnd) >= FLIP_GAP) return camera;
    return prevEnd >= 1 + FLIP_GAP ? "base" : "punch";
  };
  for (const seg of segmentsOf(plan)) {
    const atStart = cuts.some(c => Math.abs(c - seg.start) < 0.5 / FPS);
    const inside = cuts.filter(c => c > seg.start + 0.5 / FPS && c < seg.end - 0.5 / FPS);
    let cam = atStart ? flipped(seg.camera, seg.layout) : seg.camera;
    let from = seg.start;
    for (const c of inside) {
      push(from, c, seg.layout, cam);
      cam = flipped(seg.camera, seg.layout);
      from = c;
    }
    push(from, seg.end, seg.layout, cam);
  }
  return shots;
}

/**
 * The view rectangle (source pixels, fractional) of a moving camera at progress p in [0, 1] over
 * the full layout's base crop. Zooming holds the anchor point fixed on screen. ffmpeg's scale
 * and crop expressions in render.ts compute the same numbers, and preview.ts carries a copy of this
 * function, kept in step by tests.
 */
export function moveRect(base: Rect, move: CameraMove, p: number): Rect {
  const q = clamp(p, 0, 1);
  const z = move.z0 + (move.z1 - move.z0) * q;
  const ax = move.ax0 + (move.ax1 - move.ax0) * q;
  const ay = move.ay0 + (move.ay1 - move.ay0) * q;
  const w = base.w / z;
  const h = base.h / z;
  return { x: base.x + ax * (base.w - w), y: base.y + ay * (base.h - h), w, h };
}

/**
 * Source-pixel crop rect for the `full` layout, punched in around the face center when needed.
 *
 * `plan.perception.face` is the RAW median box, which perceive.ts still fills with a neutral
 * placeholder when it could not reliably detect a face. Punching in on that placeholder frames an
 * arbitrary off-center region of a video that may have no speaker at all. geometry.ts's no-face
 * branch signals exactly this case by emitting a ZERO-SIZE face rect, so use the geometry rect's
 * size as the "is this a real detection" test and punch in on the crop's own center instead.
 */
export function fullCropRect(plan: ShortPlan, punchIn: boolean | number): Rect {
  const base = plan.geometry.full.crop;
  if (punchIn === false || (typeof punchIn === "number" && punchIn <= 1)) return base;
  const srcW = plan.source.width;
  const srcH = plan.source.height;
  const zoom = typeof punchIn === "number" ? punchIn : punchZoom(plan);
  const detected = plan.geometry.full.face.w > 0 && plan.geometry.full.face.h > 0;
  const faceCx = detected ? (plan.perception.face.x + plan.perception.face.w / 2) * srcW : base.x + base.w / 2;
  const faceCy = detected ? (plan.perception.face.y + plan.perception.face.h / 2) * srcH : base.y + base.h / 2;
  const w = base.w / zoom;
  const h = base.h / zoom;
  const x = clamp(faceCx - w / 2, 0, srcW - w);
  const y = clamp(faceCy - h / 2, 0, srcH - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Crop for the `split` layout, or null when geometry gave none (bare scale). Punched in, it keeps
 * the same horizontal center and the same top edge, so the headroom above the hair holds and the
 * face stays inside the frame.
 */
export function splitCropRect(plan: ShortPlan, punchIn: boolean | number): Rect | null {
  const base = (plan.geometry.split as { crop?: Rect }).crop ?? null;
  if (!base || punchIn === false || (typeof punchIn === "number" && punchIn <= 1)) return base;
  const zoom = typeof punchIn === "number" ? punchIn : punchZoom(plan);
  const w = base.w / zoom;
  const h = base.h / zoom;
  const x = clamp(base.x + (base.w - w) / 2, 0, plan.source.width - w);
  const y = clamp(base.y, 0, plan.source.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Plain-JS copy of {@link moveRect} for the preview page, which has no build step. A test evaluates
 * this source and compares it with moveRect, so the two cannot drift apart.
 */
export const MOVE_RECT_JS = `function moveRect(base, move, p) {
    var q = Math.min(1, Math.max(0, p));
    var z = move.z0 + (move.z1 - move.z0) * q;
    var ax = move.ax0 + (move.ax1 - move.ax0) * q;
    var ay = move.ay0 + (move.ay1 - move.ay0) * q;
    var w = base.w / z, h = base.h / z;
    return { x: base.x + ax * (base.w - w), y: base.y + ay * (base.h - h), w: w, h: h };
  }`;
