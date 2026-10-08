/**
 * Shared types for the `short/` pipeline — mirrors CONTRACT.md exactly.
 * geometry.ts, transcribe.ts, perceive.ts, decide.ts, copy.ts, assemble.ts,
 * plan.ts all import from here so downstream consumers (film/, render.ts,
 * auto.ts, built by other agents) get one source of truth.
 */

import type { CleanStats, LoudnormMeasure } from "./clean/types";

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

export type CaptionStyleId =
  | "word_pop"
  | "single_word"
  | "karaoke_line"
  | "boxed_highlight"
  | "typewriter_line"
  // 24fps.dev caption presets, drawn by the vendored engine (see hook.ts CAPTION24)
  | "anton_karaoke"
  | "archivo_chip"
  | "inter_editorial";

/** Opening-hook looks, each backed by one 24fps preset (hook.ts HOOK_PRESET_BY_STYLE). */
export type HookStyleId = "giant_word" | "giant_number" | "giant_question" | "focus_word" | "ghost_topic";

export type TextEffectId =
  | "typewriter"
  | "word_pop"
  | "slide_up"
  | "blur_in"
  | "scramble_decode"
  | "highlighter_swipe"
  | "scale_punch"
  | "mask_reveal";

/** How the camera treats the speaker for one shot (framing.ts cameraRect turns each into a crop). */
export type CameraId = "base" | "punch" | "face_closeup" | "push_in" | "drift";

/** What sits on top of the speaker during one shot. */
export type OverlayId = "none" | "card" | "keyword_pill" | "giant_word";

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
  /** ADDITIVE: one caption-style answer per section (about 14 s of speech), asked with all 8 styles. */
  sections?: SectionDecision[];
  /** ADDITIVE: opening-hook look (absent in decisions made before the hook stage existed). */
  hookStyle?: { choice: HookStyleId; probabilities: Record<string, number>; confidence: number };
}

export interface SectionDecision {
  /** Shot ids [firstShot, lastShot] this section covers (inclusive). */
  firstShot: string;
  lastShot: string;
  start: number;
  end: number;
  captionStyle: { choice: CaptionStyleId; probabilities: Record<string, number>; confidence: number };
}

export interface BeatDecision {
  beatId: string;
  needsVisual: number; // noul
  template: { choice: TemplateId; probabilities: Record<string, number>; confidence: number };
  textEffect: { choice: TextEffectId; probabilities: Record<string, number>; confidence: number };
  transition: { choice: TransitionId; probabilities: Record<string, number>; confidence: number };
  /** noul. With shots this is P(camera = punch), kept so older consumers still read a number. */
  punchIn: number;
  /** ADDITIVE: the per-shot menus. Absent in decisions made before shots existed. */
  overlay?: { choice: OverlayId; probabilities: Record<string, number>; confidence: number };
  camera?: { choice: CameraId; probabilities: Record<string, number>; confidence: number };
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
  /** ADDITIVE: raw hook copy from the model (validated in hook.ts normalizeHookCopy). */
  hook?: { word?: unknown; line?: unknown };
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
  /** ADDITIVE: the card appears only from this OUTPUT time (set on a first beat that starts inside
   *  the opening hook, so the hook owns the first seconds and the card follows it). */
  visualFrom?: number;
}

/** ADDITIVE: the opening hook, a 24fps text preset (often behind the speaker) over the first seconds. */
export interface HookPlan {
  style: HookStyleId;
  presetId: string;
  /** OUTPUT seconds the hook lasts (a sentence boundary near 3 s). */
  endSec: number;
  /** true = a person matte exists, so behind-subject layers really sit behind the speaker. */
  cutout: boolean;
  /** Frames of the person cut-out, fg/00000.png .. beside film.html (0 without a cut-out). */
  fgFrames: number;
  fgDir: string;
  word: string;
  line: string;
  /** The engine text preset with word and line bound in. */
  preset: Record<string, unknown>;
  /** Why the front-of-speaker fallback was used, when it was. */
  fallbackReason?: string;
}

/** ADDITIVE: one 2 to 3 second shot, the unit the camera, overlay and giant-word choices are made on. */
export interface ShotPlan {
  id: string;
  start: number;
  end: number;
  text: string;
  wordRange: [number, number];
  /** Id of the (possibly merged) beat that owns this shot's card, if any. */
  beatId: string;
  layout: "full" | "split";
  camera: CameraId;
  /** What Jev picked before the rhythm guardrails ran (equal to the final value when nothing overrode it). */
  jev: { camera: CameraId; overlay: OverlayId };
  overlay: OverlayId;
  /** Behind-the-speaker giant word, when overlay is giant_word. */
  giantWord?: string;
  /** The transition played at the start of this shot (the first shot of a beat carries the beat's own). */
  transitionIn: TransitionId;
  /** Caption style while this shot is on screen (changes only at section boundaries). */
  captionStyle: CaptionStyleId;
  /** Plain-English reasons a guardrail changed Jev's pick, in the order they fired. */
  overrides: string[];
}

/** ADDITIVE: a mid-video giant word behind the speaker (the hook is separate, in HookPlan). */
export interface GiantPlan {
  shotId: string;
  start: number;
  end: number;
  word: string;
  /** Frames of the person cut-out for this window: fg/g<index>/00000.png ... beside film.html. */
  fgDir: string;
  fgFrames: number;
  /** Frame index in fgDir = round((t - start) * fps). */
  cutout: boolean;
  /** The engine text preset with the word bound in. */
  preset: Record<string, unknown>;
  presetId: string;
}

export interface RhythmReport {
  /** Longest stretch (seconds) with no visible change after the guardrails ran. */
  maxGapSec: number;
  cardCoverage: number;
  /** Every override as {shotId, rule, from, to}, also folded into each shot's `overrides`. */
  overrides: { shotId: string; rule: string; from: string; to: string }[];
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
  /** ADDITIVE: OUTPUT-time seconds of every visible cut the clean stage made (already collapsed so
   *  cuts closer than ~1.5 s count once). render/preview alternate the framing at each one. */
  cuts?: number[];
  /** ADDITIVE: pass-1 loudnorm measurement of the clean source, fed to pass 2 in the final render. */
  loudness?: LoudnormMeasure;
  /** ADDITIVE: what the clean stage did (absent with --no-clean). */
  clean?: CleanStats;
  timings?: Record<string, number>;
  /** ADDITIVE: the opening hook (absent = no hook stage). */
  hook?: HookPlan;
  /** ADDITIVE: overlay-only effects. `leaks` = OUTPUT times of warm light-leak flashes at section changes. */
  fx?: { leaks: number[] };
  /** ADDITIVE: the shot list with camera and overlay per shot (absent = one shot per beat, old plans). */
  shots?: ShotPlan[];
  /** ADDITIVE: mid-video behind-the-speaker giant words. */
  giants?: GiantPlan[];
  /** ADDITIVE: what the rhythm guardrails changed. */
  rhythm?: RhythmReport;
  /** ADDITIVE: caption style per section, changing only at section boundaries. */
  captionSections?: { start: number; end: number; style: CaptionStyleId }[];
}
