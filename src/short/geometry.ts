/**
 * Derives plan.geometry from the median face box (normalized, source space).
 * Written first — everything else in short/ imports the Geometry type from
 * ./types and this function.
 *
 * Assumptions not fully pinned down by CONTRACT.md, called out here:
 * - "pad face 12%" = grow the box by 12% of its own w/h on EACH side (so the
 *   padded box is 24% wider/taller, same center). Matches "Nothing may be
 *   drawn intersecting face" being a generous no-go zone.
 * - `split` assumes the source frame is (near-)square, per "source square
 *   scaled to 1080x1080"; if it isn't, we center-crop to a square first.
 * - the caption band is reserved at its WORST-CASE height across all five caption styles
 *   (its text sits ±CAPTION_BAND_HALF around captionY); visualRect starts one half-band below
 *   captionY so the band never overlaps it. See CAPTION_BAND_HALF for the measured derivation.
 */
import type { FaceBox, Geometry, Rect } from "./types";

const PAD = 0.12; // fraction of face w/h added on EACH side
const CAPTION_MARGIN = 110; // px below chin to caption band center
const CAPTION_Y_MAX = 1500;
const SPLIT_CAPTION_MARGIN = 100; // px below chin to caption band center, split layout
const SPLIT_CAPTION_Y_MAX = 1560;
const SAFE_X0 = 60;
const SAFE_X1 = 960;
const SAFE_Y1 = 1580;
// Half-height of the caption's own box, reserved so a card can never be drawn under it.
// This MUST be the worst case across every caption style, because the card rect is computed
// here once (before finalize() picks the style) and each card sizes itself to that rect at
// build time — the band cannot be re-derived per chunk without the card resizing mid-beat.
//
// Measured against captions.js rather than guessed:
//   fitFontSize() clamps to [60,118]px and the line box is line-height 1.06, so
//     karaoke_line / word_pop  118 * 1.06 = 125.1 -> half 62.6
//     boxed_highlight          font *0.9 = 106, +0.16em pill padding = 123 -> half 61.5
//     typewriter_line          font *0.82 = 97 -> 102.8 -> half 51.4
//     single_word              max(132, <=118) = 132 * 1.06 = 140 -> half 70.0  <- worst
//   + 3px of -webkit-text-stroke on the cap/descender edge, + 3px clearance.
// The old value of 45 was only correct up to an ~85px caption; since chunks cap at 3 words,
// captions are SHORT and therefore render at the LARGEST sizes, so the undersized band was
// the common case, not the edge case — it overlapped 60 of 63 chunks on the reference clip.
//
// Caveat left in place deliberately: a chunk past ~27 characters drives fitFontSize to its 60px
// floor and can wrap to two lines, which doubles the band. The 3-word chunk cap makes that rare
// (max 21 chars on the reference clip); if wrapping ever shows up, cap the chunk text length in
// captions.js rather than inflating this constant and starving every card of height.
const CAPTION_BAND_HALF = 76;

function padFace(face: FaceBox): FaceBox {
  const padW = face.w * PAD;
  const padH = face.h * PAD;
  return { x: face.x - padW, y: face.y - padH, w: face.w + 2 * padW, h: face.h + 2 * padH };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

/**
 * DEFECT 5 fix: `full` layout wants a 9:16 crop (cropW = srcH*9/16) out of the source. That is only
 * satisfiable when srcW >= cropW. A source narrower than 9:16 (e.g. 480x1920, ratio 0.25 vs the
 * target 0.5625) would previously produce cropX = clamp(cx - cropW/2, 0, max(0, srcW-cropW)) with
 * cropW itself left larger than srcW — a crop rect wider than the frame, which ffmpeg's `crop` filter
 * refuses at run time ("Crop area is not within the source"), crashing stage 7 well after planning
 * succeeded. Fix: when the source can't supply the full 9:16 width, use the full source width instead
 * and shrink the crop height to match the 9:16 aspect (still centered on the anchor), rather than
 * leaving an out-of-bounds rect. This keeps the crop valid and undistorted (scale=1080:1920 downstream
 * still maps a true-9:16 rect); it trades vertical field of view rather than adding true pillarbox bars,
 * because the ffmpeg filter chain that consumes this crop (render.ts) does a plain crop+scale with no
 * pad step for `full` — adding real letterbox/pillarbox bars would require a render.ts change, which is
 * out of scope/ownership here. This branch only fires on already-pathological input; ordinary sources
 * (including landscape ones like 2560x1080, where cropW=607.5 <= srcW) are unaffected and behave exactly
 * as before (cropY stays 0, full height used).
 */
function computeFullCrop(anchorCxSrc: number, anchorCySrc: number, srcW: number, srcH: number): Rect {
  let cropW = (srcH * 9) / 16;
  let cropH = srcH;
  let cropY = 0;
  if (cropW > srcW) {
    cropW = Math.max(1, srcW);
    cropH = Math.max(1, Math.min(srcH, (cropW * 16) / 9));
    cropY = clamp(anchorCySrc - cropH / 2, 0, Math.max(0, srcH - cropH));
  }
  const cropX = clamp(anchorCxSrc - cropW / 2, 0, Math.max(0, srcW - cropW));
  return roundRect({ x: cropX, y: cropY, w: cropW, h: cropH });
}

/**
 * DEFECT 1 fix: when perceive.ts could not reliably detect a face (see Perception.hasReliableFace),
 * we must not derive crop/caption/visual placement from a fabricated face location — the median box
 * perceive.ts still returns in that case is a neutral placeholder, not a detection, and the old
 * fallback ({x:0.3,y:0.1,...}) plus `synthesizeDescriptionFromFace` used to confidently assert a
 * head-and-shoulders speaker that might not exist at all (a screen recording, product demo, animation,
 * b-roll, pet video, ...). This is an explicit branch, not an accident of what the fallback numbers
 * happen to compute:
 *  - `full`: crop centered on the FRAME (not a face cx/cy), still clamped per computeFullCrop above.
 *  - `split`: a plain centered square crop — critically, NOT the head-top-anchored/zoomed treatment
 *    (SPLIT_ZOOM + headTopSrc) used when a face is real, since there is no head to anchor on.
 *  - captions go to a fixed safe-area position instead of "face bottom + margin below the chin".
 *  - both `face` rects are reported zero-size at frame center: a harmless no-go zone (nothing
 *    intersects an empty rect) that still satisfies the (non-optional) Geometry Rect shape.
 */
const NO_FACE_FULL_CAPTION_Y = 1400; // fixed lower-safe-area caption position (within [150,1580])
const NO_FACE_SPLIT_CAPTION_Y = 1500; // ditto, in the split layout's speaker rect (840..1920)

function computeGeometryNoFace(srcW: number, srcH: number): Geometry {
  const cx = srcW / 2;
  const cy = srcH / 2;
  const fullCrop = computeFullCrop(cx, cy, srcW, srcH);
  const zeroFace: Rect = { x: Math.round(cx), y: Math.round(cy), w: 0, h: 0 };

  const visualTop = clamp(NO_FACE_FULL_CAPTION_Y + CAPTION_BAND_HALF, 0, SAFE_Y1 - 40);
  const fullVisualRect: Rect = {
    x: SAFE_X0,
    y: visualTop,
    w: SAFE_X1 - SAFE_X0,
    h: Math.max(40, SAFE_Y1 - visualTop),
  };

  // Plain centered square crop — no SPLIT_ZOOM, no head-top anchoring (there is no head).
  const squareSize = Math.max(1, Math.min(srcW, srcH));
  const squareX = clamp(cx - squareSize / 2, 0, Math.max(0, srcW - squareSize));
  const squareY = clamp(cy - squareSize / 2, 0, Math.max(0, srcH - squareSize));
  const speaker: Rect = { x: 0, y: 840, w: 1080, h: 1080 };
  const panel: Rect = { x: 0, y: 0, w: 1080, h: 840 };

  return {
    full: {
      crop: fullCrop,
      face: zeroFace,
      captionY: NO_FACE_FULL_CAPTION_Y,
      visualRect: roundRect(fullVisualRect),
    },
    split: {
      speaker: roundRect(speaker),
      crop: roundRect({ x: squareX, y: squareY, w: squareSize, h: squareSize }),
      panel: roundRect(panel),
      face: { x: Math.round(speaker.x + speaker.w / 2), y: Math.round(speaker.y + speaker.h / 2), w: 0, h: 0 },
      captionY: NO_FACE_SPLIT_CAPTION_Y,
    },
  };
}

export function computeGeometry(face: FaceBox, srcW: number, srcH: number, hasReliableFace = true): Geometry {
  if (!hasReliableFace) return computeGeometryNoFace(srcW, srcH);

  const padded = padFace(face);
  // padded face in SOURCE px
  const faceSrc: Rect = { x: padded.x * srcW, y: padded.y * srcH, w: padded.w * srcW, h: padded.h * srcH };
  const faceCxSrc = (face.x + face.w / 2) * srcW; // unpadded center for crop centering
  const faceCySrc = (face.y + face.h / 2) * srcH; // unpadded center; only used if the narrow-source branch fires

  // ---- full layout: crop 9:16 out of the source, centered on face cx (clamped to source bounds) ----
  const { x: cropX, y: cropY, w: cropW, h: cropH } = computeFullCrop(faceCxSrc, faceCySrc, srcW, srcH);
  const scaleFull = 1080 / cropW; // == 1920 / cropH by construction

  const fullFace: Rect = {
    x: (faceSrc.x - cropX) * scaleFull,
    y: (faceSrc.y - cropY) * scaleFull,
    w: faceSrc.w * scaleFull,
    h: faceSrc.h * scaleFull,
  };
  const fullCaptionY = clamp(fullFace.y + fullFace.h + CAPTION_MARGIN, 0, CAPTION_Y_MAX);
  const visualTop = clamp(fullCaptionY + CAPTION_BAND_HALF, 0, SAFE_Y1 - 40);
  const fullVisualRect: Rect = {
    x: SAFE_X0,
    y: visualTop,
    w: SAFE_X1 - SAFE_X0,
    h: Math.max(40, SAFE_Y1 - visualTop),
  };

  // ---- split layout: square crop of the source, zoomed SPLIT_ZOOM around the face so the speaker
  // reads at phone size, anchored on the estimated TOP OF THE HEAD (hair extends ~half a face-height
  // above the Vision box, which only spans forehead-to-chin) with SPLIT_HEADROOM px of empty space
  // between the panel edge and the top of the hair; scaled to 1080x1080 at y 840..1920 ----
  const SPLIT_ZOOM = 1.12;
  const SPLIT_HEADROOM = 36; // output px of empty space between the panel edge and the top of the hair
  const squareSize = Math.min(srcW, srcH) / SPLIT_ZOOM;
  const headTopSrc = Math.max(0, (face.y - 0.5 * face.h) * srcH);
  const squareX = clamp(faceCxSrc - squareSize / 2, 0, Math.max(0, srcW - squareSize));
  const scaleSplit = 1080 / squareSize;
  const squareY = clamp(headTopSrc - SPLIT_HEADROOM / scaleSplit, 0, Math.max(0, srcH - squareSize));
  const speaker: Rect = { x: 0, y: 840, w: 1080, h: 1080 };

  const splitFace: Rect = {
    x: (faceSrc.x - squareX) * scaleSplit + speaker.x,
    y: (faceSrc.y - squareY) * scaleSplit + speaker.y,
    w: faceSrc.w * scaleSplit,
    h: faceSrc.h * scaleSplit,
  };
  const splitCaptionY = clamp(splitFace.y + splitFace.h + SPLIT_CAPTION_MARGIN, 0, SPLIT_CAPTION_Y_MAX);

  // full panel rect (0,0,1080,840) — the film core owns the content-box inset within it, not us
  const panel: Rect = { x: 0, y: 0, w: 1080, h: 840 };

  return {
    full: {
      crop: roundRect({ x: cropX, y: cropY, w: cropW, h: cropH }),
      face: roundRect(fullFace),
      captionY: Math.round(fullCaptionY),
      visualRect: roundRect(fullVisualRect),
    },
    split: {
      speaker: roundRect(speaker),
      crop: roundRect({ x: squareX, y: squareY, w: squareSize, h: squareSize }),
      panel: roundRect(panel),
      face: roundRect(splitFace),
      captionY: Math.round(splitCaptionY),
    },
  };
}
