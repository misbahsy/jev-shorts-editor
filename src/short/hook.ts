/**
 * Opening hook + 24fps preset glue. Pure logic (no ffmpeg, no browser) so it is unit-testable:
 *   - preset loading from film/presets24/manifest.json
 *   - where the hook ends (a sentence boundary near 3 s)
 *   - binding the model's giant word and short line into a hook preset
 *   - the front-of-speaker fallback when no person matte is available
 *   - mapping our word timings into the engine's caption words
 *   - where the light-leak flashes go, and their envelope
 *
 * The engine itself runs inside film.html (film/vendor/engine.js, MIT, 24fps.dev); this file only
 * prepares data for it.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Beat, CaptionStyleId, HookStyleId, Word } from "./types";

export const PRESET_DIR = resolve(import.meta.dirname, "film", "presets24");
const FPS = 30;
const snap = (t: number) => Math.round(t * FPS) / FPS;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- manifest / presets ----

export interface ManifestEntry {
  id: string;
  kind: "text" | "captions" | "effect" | "transition" | "layout";
  role: string;
  file: string;
  page: string;
  needsCutout: boolean;
  credit: string;
  author: string | null;
  license: string | null;
  licenseNote: string;
}

export interface Preset24 {
  id: string;
  name: string;
  summary: string;
  use_when: string;
  tags: string[];
  needs_cutout: boolean;
  kind: ManifestEntry["kind"];
  script?: string;
  /** the engine preset object, passed to mount() */
  preset: Record<string, any>;
}

export function loadManifest(dir = PRESET_DIR): { presets: ManifestEntry[] } {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
}

export function loadPreset(id: string, dir = PRESET_DIR): Preset24 {
  const entry = loadManifest(dir).presets.find(p => p.id === id);
  if (!entry) throw new Error(`24fps preset not in manifest: ${id}`);
  const p = JSON.parse(readFileSync(resolve(dir, "..", entry.file), "utf8")) as Preset24;
  if (p.id !== id) throw new Error(`24fps preset file ${entry.file} has id ${p.id}, expected ${id}`);
  return p;
}

export const HOOK_PRESET_BY_STYLE: Record<HookStyleId, string> = {
  giant_word: "giant-word-behind-head",
  giant_number: "giant-number-behind-head",
  giant_question: "giant-question-behind-head",
  focus_word: "focus-behind-subject-solid",
  ghost_topic: "giant-white-word-top-cropped-behind",
};

export const DEFAULT_HOOK_STYLE: HookStyleId = "giant_word";

/** The caption styles that are drawn by the engine, and the knobs we override per style. */
export const CAPTION24: Partial<Record<CaptionStyleId, { presetId: string; overrides: Record<string, unknown> }>> = {
  anton_karaoke: { presetId: "pop-anton-yellow-karaoke", overrides: {} },
  archivo_chip: { presetId: "pop-archivo-red-chip", overrides: {} },
  inter_editorial: { presetId: "ed-inter-instrument", overrides: {} },
};

export const LEAK_PRESET_ID = "warm-light-leak-drift-recurring-e5x";

export function isEngineCaption(style: string): boolean {
  return style in CAPTION24;
}

/** Engine caption preset for a style id (null for our own caption styles). */
export function resolveCaptionPreset(style: CaptionStyleId, dir = PRESET_DIR): Record<string, any> | null {
  const c = CAPTION24[style];
  if (!c) return null;
  return { ...loadPreset(c.presetId, dir).preset, ...c.overrides };
}

/** The light-leak preset reduced to what the overlay needs: the warm gradient only. The engine's
 *  vignette, grain and grade all act on the footage (not in the page), so they are dropped. */
export function leakPreset(dir = PRESET_DIR): Record<string, any> {
  const { type } = loadPreset(LEAK_PRESET_ID, dir).preset;
  return { type };
}

// ---- where the hook ends ----

export const HOOK_MIN_SEC = 2.4;
export const HOOK_MAX_SEC = 4.2;
export const HOOK_DEFAULT_SEC = 3.0;

const SENTENCE_END = /[.!?]["')\]]*$/;

/**
 * The hook ends on the first sentence boundary that falls in [2.4, 4.2] s, else on the first beat
 * boundary in that range, else at 3.0 s. Everything is capped to the clip length.
 */
export function pickHookEnd(words: Word[], beatStarts: number[], durationSec: number): number {
  const cap = Math.max(1, durationSec - 0.5);
  const inRange = (t: number) => t >= HOOK_MIN_SEC && t <= HOOK_MAX_SEC;
  const sentence = words.find(w => inRange(w.end) && SENTENCE_END.test(w.text.trim()));
  const boundary = beatStarts.find(inRange);
  const t = sentence ? sentence.end + 0.1 : boundary ?? HOOK_DEFAULT_SEC;
  return snap(Math.min(t, cap));
}

/** The words spoken during the hook, as the prompt shows them to the copy model. */
export function hookOpeningText(words: Word[], endSec: number): string {
  return words
    .filter(w => w.start < endSec)
    .map(w => w.text.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- hook copy ----

const STOP = new Set("the a an and or but so to of in on at for with is are was were be it this that you your i we they he she as by from not no do does did have has had will would can could just very".split(" "));

function cleanWord(s: string): string {
  return s.replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%?]+$/gu, "").trim();
}

/** Validates the model's hook copy; falls back to words from the opening sentence. */
export function normalizeHookCopy(raw: { word?: unknown; line?: unknown } | undefined, opening: string): { word: string; line: string } {
  const toStr = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  let word = toStr(raw?.word)
    .split(" ")
    .map(cleanWord)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (!word) {
    const candidates = opening.split(/\s+/).map(cleanWord).filter(w => w.length >= 3 && !STOP.has(w.toLowerCase()));
    word = (candidates.sort((a, b) => b.length - a.length)[0] ?? cleanWord(opening.split(/\s+/)[0] ?? "") ?? "").slice(0, 12);
  }
  word = word.slice(0, 14).toUpperCase();
  let line = toStr(raw?.line)
    .split(" ")
    .slice(0, 7)
    .join(" ")
    .replace(/[.,;:]+$/, "");
  if (!line) line = opening.split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:!?]+$/, "");
  return { word, line };
}

// ---- binding copy into a hook preset ----

/** Average glyph width per em for a few display fonts (upper case), used to fit one line to the frame. */
const GLYPH_EM: Record<string, number> = { Anton: 0.47, "Bebas Neue": 0.42, Staatliches: 0.52, Poppins: 0.7, Inter: 0.7 };

/** Largest font size (fraction of frame height) that fits `text` on one line in `widthFrac` of the frame width. */
export function fitSize(maxSize: number, text: string, family: string, widthFrac = 0.9, minSize = 0.12): number {
  const em = GLYPH_EM[family] ?? 0.6;
  const px = (1080 * widthFrac) / (Math.max(1, text.length) * em);
  return Math.round(clamp(px / 1920, minSize, maxSize) * 1000) / 1000;
}

const isBehind = (l: any) => l.z === "behind-subject";

export interface BoundHook {
  presetId: string;
  preset: Record<string, any>;
}

/**
 * Binds the hook word into every behind-subject layer and the line into the first front layer;
 * other front layers (the library demo's fabricated "listen up" / "free to try" tags) are
 * dropped. The scene lasts exactly until `endSec` and fades out over the last 0.3 s.
 */
export function bindHook(presetId: string, copy: { word: string; line: string }, endSec: number, dir = PRESET_DIR): BoundHook {
  const src = loadPreset(presetId, dir).preset;
  const layers: any[] = JSON.parse(JSON.stringify(src.layers ?? []));
  const out: any[] = [];
  let usedLine = false;
  const fadeAt = Math.max(0.5, endSec - 0.3);
  for (const l of layers) {
    if (isBehind(l)) {
      l.text = copy.word;
      l.size = fitSize(l.size ?? 0.25, copy.word, l.font?.family ?? "Anton", l.width ?? 0.9);
      l.out = { type: "fade", at: fadeAt, dur: 0.3 };
      out.push(l);
    } else if (!usedLine && copy.line) {
      usedLine = true;
      l.text = copy.line;
      if (l.in && typeof l.in.at === "number") l.in = { ...l.in, at: Math.min(l.in.at, Math.max(0, endSec - 0.8)) };
      l.out = { type: "fade", at: fadeAt, dur: 0.3 };
      // the line is fitted in two lines at most
      l.width = l.width ?? 0.8;
      out.push(l);
    }
  }
  return { presetId, preset: { ...src, duration: endSec, layers: out } };
}

/**
 * No cut-out available: the giant word cannot hide behind the speaker, so it moves in FRONT but
 * shrinks and sits in the headroom above the face (faceTopFrac = face top / frame height), where it
 * covers nothing.
 */
export function frontFallback(bound: BoundHook, faceTopFrac: number): BoundHook {
  const top = 0.045;
  const avail = Math.max(0.08, faceTopFrac - top);
  const preset = JSON.parse(JSON.stringify(bound.preset)) as Record<string, any>;
  for (const l of preset.layers as any[]) {
    if (!isBehind(l)) continue;
    l.z = "front";
    l.size = Math.min(l.size ?? 0.12, 0.13, avail * 0.8);
    l.y = top + avail / 2;
    l.x = l.x === 0.62 ? 0.62 : 0.5;
    l.shadow = true;
  }
  return { presetId: bound.presetId, preset };
}

export function hasBehindLayer(preset: Record<string, any>): boolean {
  return ((preset.layers ?? []) as any[]).some(isBehind);
}

// ---- captions ----

export interface EngineWord {
  w: string;
  s: number;
  e: number;
  emph: boolean;
}

/** Our word timings as the engine's caption words (asterisk emphasis is our `emph` flag). */
export function captionWords(words: Word[]): EngineWord[] {
  return words
    .map(w => ({ w: w.text.trim(), s: w.start, e: w.end, emph: !!w.emph }))
    .filter(w => w.w.length > 0);
}

/** Vertical shift (px) that moves a caption band authored at `presetY` (fraction) onto our caption row. */
export function captionShift(presetY: number, captionYPx: number): number {
  return Math.round(captionYPx - presetY * 1920);
}

// ---- light leaks ----

export const LEAK_MAX = 4;
export const LEAK_MIN_GAP = 4;

/**
 * Times for warm light-leak flashes: layout changes (the speaker/graphics section changes) after
 * the hook, at least 4 s apart, at most four. A video with no layout change falls back to a few
 * beat starts 8 s apart so a long single-layout video still gets some punctuation.
 */
export function leakTimes(beats: Pick<Beat, "start" | "layout">[], hookEnd: number): number[] {
  const pick = (cands: number[], gap: number, max: number) => {
    const out: number[] = [];
    for (const t of cands) {
      if (out.length >= max) break;
      if (out.length === 0 || t - out[out.length - 1] >= gap) out.push(t);
    }
    return out;
  };
  const after = beats.filter((b, i) => i > 0 && b.start >= hookEnd + 1.0);
  const changes = after.filter(b => b.layout !== beats[beats.indexOf(b) - 1].layout).map(b => snap(b.start));
  if (changes.length > 0) return pick(changes, LEAK_MIN_GAP, LEAK_MAX);
  return pick(after.map(b => snap(b.start)), 8, 3);
}

/** Opacity of the leak layer at t: a fast 0.08 s rise into each flash time, a 0.35 s fall after it. */
export function leakEnvelope(t: number, times: number[]): number {
  let best = 0;
  for (const s of times) {
    const d = t - s;
    let v = 0;
    if (d >= -0.08 && d < 0) v = (d + 0.08) / 0.08;
    else if (d >= 0 && d < 0.35) v = 1 - d / 0.35;
    if (v > best) best = v;
  }
  return Math.round(best * 1000) / 1000;
}
