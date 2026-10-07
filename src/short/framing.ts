/**
 * Framing shared by render.ts (ffmpeg crop) and preview.ts (CSS crop): which crop rect is on screen
 * at each moment. Two things change the framing:
 *   - beat.punchIn, the pipeline's own emphasis zoom (full layout only), and
 *   - the clean stage's cuts. Every visible cut flips between the normal and a punched-in crop, so
 *     a jump cut reads as a deliberate camera change instead of a glitch.
 * The shot list is computed once here and the preview receives it as data, so the two can never
 * disagree about where a cut is or which way it flips.
 */
import type { ShortPlan, Rect } from "./types";

/** Zoom of a plain beat punch-in (plans made without the clean stage keep this). */
export const BEAT_PUNCH_ZOOM = 1.1;
/** Zoom of the punched-in framing when the plan has cuts. */
export const CUT_PUNCH_ZOOM = 1.12;

const FPS = 30;
const round30 = (t: number) => Math.round(t * FPS) / FPS;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Shot {
  startSec: number;
  endSec: number;
  layout: "full" | "split";
  /** true = the zoomed-in framing for this layout. */
  punchIn: boolean;
}

export function punchZoom(plan: ShortPlan): number {
  return plan.cuts && plan.cuts.length > 0 ? CUT_PUNCH_ZOOM : BEAT_PUNCH_ZOOM;
}

/** Plan cuts on the 30 fps grid, sorted, de-duplicated. */
export function cutTimes(plan: ShortPlan): number[] {
  const out = [...new Set((plan.cuts ?? []).map(round30))].filter(t => t > 0).sort((a, b) => a - b);
  return out;
}

/**
 * Splits the beats into shots. A shot is a stretch with one layout and one framing. Inside a beat
 * the framing starts as beat.punchIn and flips at each cut. A cut that lands on a beat boundary
 * flips the framing the previous shot ended with, even if the new beat's own punchIn would have
 * landed on the same value, so every cut is visible as a framing change.
 */
export function buildShots(plan: ShortPlan): Shot[] {
  const cuts = cutTimes(plan);
  const shots: Shot[] = [];
  let prev = false; // framing the previous shot ended with
  const push = (start: number, end: number, layout: "full" | "split", punchIn: boolean) => {
    const last = shots[shots.length - 1];
    if (last && last.layout === layout && last.punchIn === punchIn && Math.abs(last.endSec - start) < 1e-6) {
      last.endSec = end;
    } else {
      shots.push({ startSec: start, endSec: end, layout, punchIn });
    }
    prev = punchIn;
  };
  for (const beat of plan.beats) {
    const start = round30(beat.start);
    const end = round30(beat.end);
    const layout = beat.layout;
    const own = layout === "full" && beat.punchIn; // split never punches in on its own
    const atStart = cuts.some(c => Math.abs(c - start) < 0.5 / FPS);
    const inside = cuts.filter(c => c > start + 0.5 / FPS && c < end - 0.5 / FPS);
    let state = atStart ? !prev : own;
    let from = start;
    for (const c of inside) {
      push(from, c, layout, state);
      state = !state;
      from = c;
    }
    push(from, end, layout, state);
  }
  return shots;
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
export function fullCropRect(plan: ShortPlan, punchIn: boolean): Rect {
  const base = plan.geometry.full.crop;
  if (!punchIn) return base;
  const srcW = plan.source.width;
  const srcH = plan.source.height;
  const zoom = punchZoom(plan);
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
export function splitCropRect(plan: ShortPlan, punchIn: boolean): Rect | null {
  const base = (plan.geometry.split as { crop?: Rect }).crop ?? null;
  if (!base || !punchIn) return base;
  const zoom = punchZoom(plan);
  const w = base.w / zoom;
  const h = base.h / zoom;
  const x = clamp(base.x + (base.w - w) / 2, 0, plan.source.width - w);
  const y = clamp(base.y, 0, plan.source.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
