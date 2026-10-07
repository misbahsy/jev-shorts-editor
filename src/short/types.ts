/**
 * Shared types for the `short/` pipeline — mirrors CONTRACT.md exactly.
 * geometry.ts, transcribe.ts, perceive.ts, decide.ts, copy.ts, assemble.ts,
 * plan.ts all import from here so downstream consumers (film/, render.ts,
 * auto.ts, built by other agents) get one source of truth.
 */

// ---- option-menu id unions (contract "Option menus" section) ----

export type StyleFamilyId =
  | "apple_glass"
  | "bold_kinetic"
  | "terminal_type"
  | "neon_cyber"
  | "paper_editorial"
  | "clean_swiss"
  | "gradient_pop"
  | "dark_luxe";

export type AccentId = "blue" | "green" | "yellow" | "orange" | "red" | "pink" | "purple" | "cyan";

export type CaptionStyleId = "word_pop" | "single_word" | "karaoke_line" | "boxed_highlight" | "typewriter_line";

export type TextEffectId =
  | "typewriter"
  | "word_pop"
  | "slide_up"
  | "blur_in"
  | "scramble_decode"
  | "highlighter_swipe"
  | "scale_punch"
  | "mask_reveal";

export type TransitionId = "hard_cut" | "flash" | "whip_streak" | "glass_wipe" | "zoom_blur" | "glitch_slice";

export type TemplateId =
  | "big_statement"
  | "stamp"
  | "keyword_pill"
  | "stat_number"
  | "versus"
  | "option_chips"
  | "confidence_meter"
  | "yes_no"
  | "scale_slider"
  | "numbered_point"
  | "checklist"
  | "chat_bubble"
  | "definition"
  | "icon_row"
  | "code_terminal"
  | "flow_steps"
  | "dual_stat"
  | "quote";

export const ALL_TEMPLATE_IDS: TemplateId[] = [
  "big_statement",
  "stamp",
  "keyword_pill",
  "stat_number",
  "versus",
  "option_chips",
  "confidence_meter",
  "yes_no",
  "scale_slider",
  "numbered_point",
  "checklist",
  "chat_bubble",
  "definition",
  "icon_row",
  "code_terminal",
  "flow_steps",
  "dual_stat",
  "quote",
];

/** Templates allowed in `full` layout (drawn inside geometry.full.visualRect, never over the face). */
export const UNDER_CHIN_TEMPLATES: Set<TemplateId> = new Set(["big_statement", "stamp", "keyword_pill", "stat_number"]);

// ---- geometry ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  full: {
    crop: Rect; // SOURCE px, region cropped before scaling to 1080x1920
    face: Rect; // OUTPUT px (1080x1920 space), padded 12%
    captionY: number; // OUTPUT px, center of caption band
    visualRect: Rect; // OUTPUT px, under-chin visual area
  };
  split: {
    speaker: Rect; // OUTPUT px (1080x1920 space), y 840..1920
    crop?: Rect; // SOURCE px square shown in `speaker` (zoomed around the face)
    panel: Rect; // OUTPUT px, panel content box
    face: Rect; // OUTPUT px, within speaker rect, padded 12%
    captionY: number; // OUTPUT px
  };
}

// ---- words / perception ----

export interface Word {
  i: number;
  text: string;
  start: number;
  end: number;
  emph?: boolean;
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Perception {
  face: FaceBox; // normalized 0..1, source, median across sampled frames
  facePerSecond: (FaceBox | null)[];
  description: string;
  /** ADDITIVE: framesWithFace / framesSampled across the 1fps sampled frames (0 if none sampled).
   *  See perceive.ts summarizeFaces() for the reliability threshold. */
  faceConfidence?: number;
  /** ADDITIVE: faceConfidence at/above perceive.ts's reliability threshold. When false, `face` is a
   *  neutral placeholder (NOT a detection) — geometry.ts and any caller must not anchor on it or
   *  assert a speaker is present. */
  hasReliableFace?: boolean;
}

// ---- Jev decisions ----

export interface GlobalDecisions {
  family: { choice: StyleFamilyId; probabilities: Record<string, number>; confidence: number };
  accent: { choice: AccentId; probabilities: Record<string, number>; confidence: number };
  captionStyle: { choice: CaptionStyleId; probabilities: Record<string, number>; confidence: number };
  energy: { score: number; probabilities: Record<string, number>; confidence: number };
  progressBar: { noul: number };
}

export interface BeatDecision {
  beatId: string;
  needsVisual: number; // noul
  template: { choice: TemplateId; probabilities: Record<string, number>; confidence: number };
  textEffect: { choice: TextEffectId; probabilities: Record<string, number>; confidence: number };
  transition: { choice: TransitionId; probabilities: Record<string, number>; confidence: number };
  punchIn: number; // noul
  sfx: { choice: string; probabilities: Record<string, number>; confidence: number };
  emphasis: { choice: string | null; probabilities: Record<string, number>; confidence: number } | null;
}

export interface JevStats {
  requestCount: number;
  latenciesMs: number[];
  p50Ms: number;
  p95Ms: number;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Decisions {
  global: GlobalDecisions;
  beats: BeatDecision[];
  stats: JevStats;
}

// ---- beats (pre-copy, from decide.ts input) ----

export interface RawBeat {
  id: string;
  start: number;
  end: number;
  text: string;
  wordRange: [number, number];
}

// ---- copy ----

export interface Copy {
  beats: Record<string, Record<string, unknown>>;
  corrections: { i: number; text: string }[];
  latencyMs: number;
}

// ---- final plan ----

export interface Beat {
  id: string;
  start: number;
  end: number;
  text: string;
  wordRange: [number, number];
  layout: "full" | "split";
  visual: null | {
    template: TemplateId;
    fields: Record<string, unknown>;
    textEffect: TextEffectId;
    confidence: number;
    /** ADDITIVE: manual override in OUTPUT-space pixels (1080x1920 frame), written by the UI when a
     *  user nudges a card away from the pipeline's computed placement. Applied to the rect the card
     *  is built into (see film/core.js), then clamped back into frame. Absent for pipeline-only plans. */
    offset?: { dx: number; dy: number };
  };
  transitionIn: TransitionId;
  punchIn: boolean;
}

export interface ShortPlan {
  source: { path: string; durationSec: number; width: number; height: number; fps: number };
  output: { width: 1080; height: 1920; fps: 30 };
  perception: {
    face: FaceBox;
    facePerSecond: (FaceBox | null)[];
    description: string;
    /** ADDITIVE: see Perception.faceConfidence — surfaced so a caller/UI can warn the user. */
    faceConfidence?: number;
    /** ADDITIVE: see Perception.hasReliableFace. */
    hasReliableFace?: boolean;
  };
  geometry: Geometry;
  style: { family: StyleFamilyId; accent: AccentId; captionStyle: CaptionStyleId; energy: number; progressBar: boolean };
  words: Word[];
  beats: Beat[];
  sfx: { type: "whoosh" | "pop" | "ding" | "riser" | "impact"; at: number; gainDb: number }[];
  timings?: Record<string, number>;
}
