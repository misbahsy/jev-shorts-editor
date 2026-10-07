/**
 * Person cut-out for the opening hook. The film frames are a transparent overlay and the video is
 * not in the page, so "text behind the speaker" needs the speaker as an overlay too: for the hook
 * window only, this
 *   1. renders the video in OUTPUT geometry (the same per-shot crop/scale/punch-in as render.ts, so
 *      the cut-out lines up pixel for pixel with what ffmpeg composites underneath),
 *   2. runs Apple Vision person segmentation over those frames (bin/matte, perceive/matte.swift),
 *   3. alphamerges the matte onto the RGB frames -> fg/%05d.png (person with alpha).
 * The film page puts fg.png above the giant word and below the captions; everything else about the
 * composite is unchanged. Any failure returns { ok: false, reason } so the caller falls back to a
 * hook layout without behind-subject layers.
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

/** ffmpeg filter graph that renders the hook window in OUTPUT geometry (one JPEG/PNG per output frame). */
export function hookWindowFilter(plan: ShortPlan, hookEnd: number): { filter: string; label: string } {
  const shots = buildShots(plan)
    .filter(s => s.startSec < hookEnd - 1e-6)
    .map(s => ({ ...s, endSec: Math.min(s.endSec, hookEnd) }));
  const parts = shots.map((s, i) => shotFilter(s, plan, i));
  const inputs = shots.map((_, i) => `[s${i}]`).join("");
  parts.push(`${inputs}concat=n=${shots.length}:v=1:a=0[hookv]`);
  return { filter: parts.join(";"), label: "hookv" };
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

export function buildCutout(
  plan: ShortPlan,
  workDir: string,
  hookEnd: number,
  opts: { quality?: MatteQuality } = {},
): CutoutResult {
  const quality = opts.quality ?? "balanced";
  const t0 = Date.now();
  const ms = { extract: 0, matte: 0, merge: 0, total: 0 };
  const frames = Math.round(hookEnd * plan.output.fps);
  const srcDir = join(workDir, "fg-src");
  const matteDir = join(workDir, "fg-matte");
  const fgDir = join(workDir, "fg");
  for (const d of [srcDir, matteDir, fgDir]) {
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
  }
  const done = (r: Omit<CutoutResult, "ms" | "quality">): CutoutResult => {
    ms.total = Date.now() - t0;
    return { ...r, ms, quality };
  };
  try {
    // 1. hook window in output geometry
    let t = Date.now();
    const { filter, label } = hookWindowFilter(plan, hookEnd);
    ffmpeg(
      [
        "-i", plan.source.path,
        "-filter_complex", filter,
        "-map", `[${label}]`,
        "-r", String(plan.output.fps), "-fps_mode", "cfr",
        "-frames:v", String(frames),
        "-q:v", "2", "-start_number", "0",
        join(srcDir, "%05d.jpg"),
      ],
      "hook-frames",
    );
    ms.extract = Date.now() - t;

    // 2. Vision person segmentation
    t = Date.now();
    const bin = ensureMatteBinary();
    const out = execFileSync(bin, [srcDir, matteDir, quality], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const report = JSON.parse(out) as { frames: FrameCoverage[] };
    ms.matte = Date.now() - t;
    const verdict = judgeCoverage(report.frames);
    if (!verdict.ok) return done({ ok: false, frames: 0, reason: verdict.reason, coverageMean: verdict.mean });

    // 3. matte -> alpha
    t = Date.now();
    ffmpeg(
      [
        "-start_number", "0", "-i", join(srcDir, "%05d.jpg"),
        "-start_number", "0", "-i", join(matteDir, "%05d.png"),
        "-filter_complex", "[0:v]format=rgb24[c];[1:v]format=gray[m];[c][m]alphamerge,format=rgba[o]",
        "-map", "[o]",
        "-compression_level", "1", "-start_number", "0",
        join(fgDir, "%05d.png"),
      ],
      "hook-alphamerge",
    );
    ms.merge = Date.now() - t;
    const written = readdirSync(fgDir).filter(f => f.endsWith(".png")).length;
    if (written < frames - 1) return done({ ok: false, frames: 0, reason: `only ${written}/${frames} cut-out frames written`, coverageMean: verdict.mean });
    rmSync(srcDir, { recursive: true, force: true });
    return done({ ok: true, frames: written, coverageMean: verdict.mean });
  } catch (err) {
    return done({ ok: false, frames: 0, reason: `cut-out failed: ${(err as Error).message.slice(0, 200)}` });
  }
}
