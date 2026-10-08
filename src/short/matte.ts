/**
 * Person cut-out for the opening hook and the mid-video giant words. The film frames are a
 * transparent overlay and the video is not in the page, so "text behind the speaker" needs the
 * speaker as an overlay too: for each window that carries a behind-the-head word (the hook, and
 * every giant-word shot), this
 *   1. renders the video in OUTPUT geometry (the same per-shot crop/scale/punch-in as render.ts, so
 *      the cut-out lines up pixel for pixel with what ffmpeg composites underneath),
 *   2. runs Apple Vision person segmentation over those frames (bin/matte, perceive/matte.swift),
 *   3. alphamerges the matte onto the RGB frames -> fg/%05d.png (person with alpha).
 * The film page puts fg.png above the giant word and below the captions; everything else about the
 * composite is unchanged. Any failure returns { ok: false, reason } for that window so the caller
 * falls back to a layout without behind-subject layers. Windows are independent: the hook writes
 * fg/00000.png.., a giant word writes fg/g<n>/00000.png.., frame index = round((t - start) * fps).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ffmpeg } from "../render/ffutil";
import { buildShots } from "./framing";
import { shotFilter } from "./render";
import type { ShortPlan } from "./types";

export type MatteQuality = "fast" | "balanced" | "accurate";

export interface CutoutResult {
  ok: boolean;
  frames: number;
  reason?: string;
  coverageMean?: number;
  /** milliseconds per step */
  ms: { extract: number; matte: number; merge: number; total: number };
  quality: MatteQuality;
}

/** A person fills at least this much of the 1080x1920 frame, on average, or the matte is not trusted. */
export const MIN_COVERAGE = 0.06;
/** ...and at least this share of frames individually reach half of it. */
export const MIN_GOOD_FRAMES = 0.8;

export interface FrameCoverage {
  file: string;
  coverage: number;
}

/** Pure check of the matte tool's per-frame coverage; returns a reason when the matte is unusable. */
export function judgeCoverage(frames: FrameCoverage[], minMean = MIN_COVERAGE): { ok: boolean; mean: number; reason?: string } {
  if (frames.length === 0) return { ok: false, mean: 0, reason: "matte produced no frames" };
  const mean = frames.reduce((s, f) => s + f.coverage, 0) / frames.length;
  if (mean < minMean) return { ok: false, mean, reason: `person coverage ${(mean * 100).toFixed(1)}% is below ${(minMean * 100).toFixed(0)}%` };
  const good = frames.filter(f => f.coverage >= minMean / 2).length / frames.length;
  if (good < MIN_GOOD_FRAMES) return { ok: false, mean, reason: `person missing in ${Math.round((1 - good) * 100)}% of frames` };
  return { ok: true, mean };
}

/**
 * ffmpeg filter graph for any window [startSec, endSec) in OUTPUT geometry. It renders every
 * camera shot that overlaps the window IN FULL (a slow push-in is a function of its own shot's
 * progress, so clipping it would change the framing) and then trims to the window. `idxBase`
 * keeps the per-shot labels unique when several windows share one ffmpeg graph.
 */
export function windowFilter(plan: ShortPlan, startSec: number, endSec: number, idxBase: number, label: string): string {
  const eps = 1e-6;
  const shots = buildShots(plan).filter(s => s.endSec > startSec + eps && s.startSec < endSec - eps);
  if (shots.length === 0) throw new Error(`no camera shot overlaps ${startSec}-${endSec}`);
  const parts = shots.map((s, i) => shotFilter(s, plan, idxBase + i));
  const inputs = shots.map((_, i) => `[s${idxBase + i}]`).join("");
  const from = Math.max(0, startSec - shots[0].startSec);
  const to = from + (endSec - startSec);
  parts.push(`${inputs}concat=n=${shots.length}:v=1:a=0,trim=start=${from.toFixed(4)}:end=${to.toFixed(4)},setpts=PTS-STARTPTS[${label}]`);
  return parts.join(";");
}

function ensureMatteBinary(): string {
  const src = resolve(import.meta.dirname, "perceive", "matte.swift");
  const binDir = resolve(import.meta.dirname, "..", "..", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "matte");
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs) {
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: ["ignore", "pipe", "pipe"] });
  }
  return bin;
}

/** One stretch of the video that needs a person cut-out. */
export interface CutWindow {
  /** Unique name, used for the scratch directories. */
  id: string;
  startSec: number;
  endSec: number;
  /** Where the cut-out frames go, relative to the work dir (fg for the hook, fg/g0 for a giant word). */
  outDir: string;
}

export function windowFrames(w: Pick<CutWindow, "startSec" | "endSec">, fps: number): number {
  return Math.max(1, Math.round((w.endSec - w.startSec) * fps));
}

/**
 * Builds the cut-out for several windows. All windows are rendered by ONE ffmpeg pass (one decode
 * of the source); each window is then segmented and alpha-merged on its own, so the temporal
 * smoothing in the matte tool never bleeds across windows and a bad window fails alone.
 */
export function buildCutouts(plan: ShortPlan, workDir: string, windows: CutWindow[], opts: { quality?: MatteQuality } = {}): Record<string, CutoutResult> {
  const quality = opts.quality ?? "balanced";
  const fps = plan.output.fps;
  const results: Record<string, CutoutResult> = {};
  if (windows.length === 0) return results;
  const scratch = join(workDir, "fg-scratch");
  rmSync(scratch, { recursive: true, force: true });
  const fgRoot = join(workDir, "fg");
  rmSync(fgRoot, { recursive: true, force: true });
  mkdirSync(fgRoot, { recursive: true });
  for (const w of windows) {
    rmSync(join(workDir, w.outDir), { recursive: true, force: true });
    mkdirSync(join(workDir, w.outDir), { recursive: true });
    mkdirSync(join(scratch, w.id, "src"), { recursive: true });
    mkdirSync(join(scratch, w.id, "matte"), { recursive: true });
  }
  const fail = (w: CutWindow, reason: string, ms: CutoutResult["ms"], coverageMean?: number) => {
    results[w.id] = { ok: false, frames: 0, reason, coverageMean, ms, quality };
  };

  // 1. every window in output geometry, one decode
  const t0 = Date.now();
  let extractMs = 0;
  try {
    const filters: string[] = [];
    const args = ["-i", plan.source.path];
    let base = 0;
    const maps: string[] = [];
    for (const w of windows) {
      filters.push(windowFilter(plan, w.startSec, w.endSec, base, `w_${w.id}`));
      base += buildShots(plan).filter(s => s.endSec > w.startSec + 1e-6 && s.startSec < w.endSec - 1e-6).length;
      maps.push(
        "-map", `[w_${w.id}]`,
        "-r", String(fps), "-fps_mode", "cfr",
        "-frames:v", String(windowFrames(w, fps)),
        "-q:v", "2", "-start_number", "0",
        join(scratch, w.id, "src", "%05d.jpg"),
      );
    }
    ffmpeg([...args, "-filter_complex", filters.join(";"), ...maps], "cutout-frames");
    extractMs = Date.now() - t0;
  } catch (err) {
    const ms = { extract: Date.now() - t0, matte: 0, merge: 0, total: Date.now() - t0 };
    for (const w of windows) fail(w, `cut-out failed: ${(err as Error).message.slice(0, 200)}`, ms);
    return results;
  }

  // 2. segment + alpha merge, window by window
  const bin = ensureMatteBinary();
  for (const w of windows) {
    const frames = windowFrames(w, fps);
    const ms = { extract: Math.round(extractMs / windows.length), matte: 0, merge: 0, total: 0 };
    const tw = Date.now();
    const srcDir = join(scratch, w.id, "src");
    const matteDir = join(scratch, w.id, "matte");
    try {
      let t = Date.now();
      const out = execFileSync(bin, [srcDir, matteDir, quality], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const report = JSON.parse(out) as { frames: FrameCoverage[] };
      ms.matte = Date.now() - t;
      const verdict = judgeCoverage(report.frames);
      if (!verdict.ok) {
        ms.total = ms.extract + Date.now() - tw;
        fail(w, verdict.reason ?? "matte unusable", ms, verdict.mean);
        continue;
      }
      t = Date.now();
      ffmpeg(
        [
          "-start_number", "0", "-i", join(srcDir, "%05d.jpg"),
          "-start_number", "0", "-i", join(matteDir, "%05d.png"),
          "-filter_complex", "[0:v]format=rgb24[c];[1:v]format=gray[m];[c][m]alphamerge,format=rgba[o]",
          "-map", "[o]",
          "-compression_level", "1", "-start_number", "0",
          join(workDir, w.outDir, "%05d.png"),
        ],
        `cutout-alphamerge-${w.id}`,
      );
      ms.merge = Date.now() - t;
      ms.total = ms.extract + Date.now() - tw;
      const written = readdirSync(join(workDir, w.outDir)).filter(f => f.endsWith(".png")).length;
      if (written < frames - 1) fail(w, `only ${written}/${frames} cut-out frames written`, ms, verdict.mean);
      else results[w.id] = { ok: true, frames: written, coverageMean: verdict.mean, ms, quality };
    } catch (err) {
      ms.total = ms.extract + Date.now() - tw;
      fail(w, `cut-out failed: ${(err as Error).message.slice(0, 200)}`, ms);
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  return results;
}

/** The hook's cut-out: the window [0, hookEnd) written to fg/. */
export function buildCutout(plan: ShortPlan, workDir: string, hookEnd: number, opts: { quality?: MatteQuality } = {}): CutoutResult {
  return buildCutouts(plan, workDir, [{ id: "hook", startSec: 0, endSec: hookEnd, outDir: "fg" }], opts).hook;
}
