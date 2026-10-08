// Stage 6 (frame capture) + Stage 7 (ffmpeg assembly) for the `short/` spike.
//
// Stage 6: N sidecar PROCESSES, each opens its own 1080x1920 transparent WKWebView
// window against film.html, and steps a contiguous, disjoint range of the GLOBAL
// frame index (t = i/30), writing frames/%05d.png per frame.
//
// Stage 7: ONE ffmpeg invocation. The shot list comes from framing.ts (shared with the
// preview): one shot per beat, split further at every clean-stage cut so the framing
// alternates between the base crop and a ~1.12x punch-in there. Each shot is a
// trim/setpts/crop-or-pad/scale of the source video; shots are concatenated, the captured
// PNG sequence (alpha) is overlaid, and the source audio (highpass, then two-pass loudnorm
// when the plan carries a loudness measurement) is mixed with the sfx and limited. Encode is
// h264_videotoolbox.
//
// CLI (mainly for the worker benchmark + standalone testing against a fixture):
//   npx tsx src/short/render.ts --plan <plan.json> --film <film.html> \
//     --out <out.mp4> --work <dir> [--workers N] [--bench] [--no-double-raf]

import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startSidecar, type SidecarHandle } from "../render/sidecar";
import { seekExpr, READY_EXPR, DOUBLE_RAF_EXPR } from "../render/seekScript";
import { ffmpeg } from "../render/ffutil";
import { resolveSfxAssets, type SfxType } from "../render/sfx";
import type { ShortPlan } from "./types";
import { loudnormPass2, HIGHPASS_HZ } from "./clean/ffmpegTools";
import type { LoudnormMeasure } from "./clean/types";
import { buildShots, fullCropRect, splitCropRect, type CameraMove, type Shot } from "./framing";

export { buildShots, fullCropRect };

// Picked from the worker benchmark on this M4 (10 cores; see final report for the
// table). Throughput peaks around 4 workers and gets WORSE at 8/10: all sidecar
// IPC (JSON-lines parsing + base64 PNG decoding) is driven by this single Node
// process's main JS thread, so more concurrent sidecar processes just add more
// bytes to decode on that one thread without adding capacity for it.
export const DEFAULT_WORKERS = 6;

// Whether to force two nested rAFs after each seek before capturing. Contractually
// renderFrame(t) is a pure synchronous DOM mutation, so WebKit's snapshot (which
// forces a synchronous layout/paint of current state, unlike a real screen frame)
// should already reflect it without waiting for a compositor frame. Benchmarked
// both ways; see report. Default false (faster); flip with --double-raf if a real
// film.html ever needs it (e.g. it defers work with rAF internally).
export const DEFAULT_USE_DOUBLE_RAF = false;

const OUT_W = 1080;
const OUT_H = 1920;

// ---------------- Stage 6: frame capture ----------------

export function splitContiguous(total: number, workers: number): Array<[number, number]> {
  const n = Math.max(1, Math.min(workers, total));
  const base = Math.floor(total / n);
  const rem = total % n;
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < rem ? 1 : 0);
    if (size <= 0) continue;
    ranges.push([start, start + size]);
    start += size;
  }
  return ranges;
}

async function waitForFilmReady(handle: SidecarHandle, windowId: number, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const ready = await handle.request("evaluate", windowId, { source: "window.__filmReady === true" });
    if (ready) return;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for window.__filmReady");
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function captureChunk(
  filmHtmlPath: string,
  framesDir: string,
  startFrame: number,
  endFrame: number,
  fps: number,
  useDoubleRaf: boolean,
  chunkIdx: number,
  onStatus?: (msg: string) => void,
): Promise<number> {
  const handle = startSidecar();
  const windowId = 1;
  try {
    await handle.request("create", windowId, {
      width: OUT_W,
      height: OUT_H,
      show: false,
      transparent: true,
      title: `jev-short-render-${chunkIdx}`,
    });
    await handle.request("setBackgroundColor", windowId, { color: "transparent" });
    await handle.request("loadFile", windowId, { path: path.resolve(filmHtmlPath) });
    await handle.request("evaluate", windowId, { source: READY_EXPR });
    await waitForFilmReady(handle, windowId);
    if (chunkIdx === 0 && onStatus) {
      // the film page shrinks overflowing card text itself; say so, and shout when it cannot fit
      const found = (await handle.request("evaluate", windowId, {
        source: "JSON.stringify(window.__filmOverflow || [])",
      })) as string;
      for (const o of JSON.parse(found || "[]") as Array<{ beat: string; template: string; text: string; from: number; to: number; fixed: boolean }>) {
        onStatus(`text overflow ${o.fixed ? "fixed" : "NOT FIXED"} in ${o.beat} ${o.template}: "${o.text}" ${o.from}px -> ${o.to}px`);
      }
    }
    if (useDoubleRaf) await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });

    let written = 0;
    for (let i = startFrame; i < endFrame; i++) {
      const t = i / fps;
      await handle.request("evaluate", windowId, { source: seekExpr(t) });
      if (useDoubleRaf) await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });
      const cap = await handle.request("capture", windowId, {});
      const buf = Buffer.from(cap.png as string, "base64");
      const fname = path.join(framesDir, `${String(i).padStart(5, "0")}.png`);
      await writeFile(fname, buf);
      written++;
    }
    await handle.request("destroy", windowId, {});
    onStatus?.(`chunk ${chunkIdx}: frames [${startFrame},${endFrame}) done`);
    return written;
  } finally {
    handle.close();
  }
}

export async function captureFrames(
  filmHtmlPath: string,
  totalFrames: number,
  framesDir: string,
  workers: number,
  fps: number,
  useDoubleRaf: boolean = DEFAULT_USE_DOUBLE_RAF,
  onStatus?: (msg: string) => void,
): Promise<{ elapsedMs: number; workersUsed: number; frames: number }> {
  mkdirSync(framesDir, { recursive: true });
  const ranges = splitContiguous(totalFrames, workers);
  const started = Date.now();
  const results = await Promise.all(
    ranges.map((r, idx) => captureChunk(filmHtmlPath, framesDir, r[0], r[1], fps, useDoubleRaf, idx, onStatus)),
  );
  const frames = results.reduce((a, b) => a + b, 0);
  return { elapsedMs: Date.now() - started, workersUsed: ranges.length, frames };
}

// ---------------- Stage 7: ffmpeg assembly ----------------

const num = (v: number) => String(Math.round(v * 1e6) / 1e6);

/**
 * ffmpeg chain for a moving camera (push_in, drift) on the full layout: crop to the base rect, scale
 * up by Z(t) per frame, then crop the fixed output window out of the enlarged picture. The window
 * offset is anchor * (scaled size - output size), which holds the anchor point still on screen
 * while the zoom grows, the same geometry as framing.ts moveRect. `t` restarts at 0 for every
 * shot because the trim is followed by setpts=PTS-STARTPTS.
 */
export function moveFilter(plan: ShortPlan, shot: Shot): string {
  const m = shot.move as CameraMove;
  const base = plan.geometry.full.crop;
  const dur = Math.max(1 / 30, shot.endSec - shot.startSec);
  const p = `clip(t/${num(dur)},0,1)`;
  const z = `(${num(m.z0)}+${num(m.z1 - m.z0)}*${p})`;
  const sw = `trunc(${OUT_W}*${z}/2)*2`;
  const sh = `trunc(${OUT_H}*${z}/2)*2`;
  const ax = `(${num(m.ax0)}+${num(m.ax1 - m.ax0)}*${p})`;
  const ay = `(${num(m.ay0)}+${num(m.ay1 - m.ay0)}*${p})`;
  return (
    `crop=${base.w}:${base.h}:${base.x}:${base.y},` +
    `scale=w='${sw}':h='${sh}':eval=frame:flags=bicubic,` +
    `crop=${OUT_W}:${OUT_H}:x='${ax}*(${sw}-${OUT_W})':y='${ay}*(${sh}-${OUT_H})'`
  );
}

export function shotFilter(shot: Shot, plan: ShortPlan, idx: number): string {
  const label = `s${idx}`;
  const head = `[0:v]trim=start=${shot.startSec}:end=${shot.endSec},setpts=PTS-STARTPTS,`;
  if (shot.layout === "split") {
    const c = splitCropRect(plan, shot.zoom);
    const crop = c ? `crop=${c.w}:${c.h}:${c.x}:${c.y},` : "";
    return `${head}${crop}scale=1080:1080,pad=1080:1920:0:840:0x0b0b0f[${label}]`;
  }
  if (shot.move) return `${head}${moveFilter(plan, shot)}[${label}]`;
  const crop = fullCropRect(plan, shot.zoom);
  return `${head}crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1080:1920[${label}]`;
}

/**
 * Audio chain. Voice goes through a highpass, mixes with the sfx, and (when the plan carries a
 * loudness measurement from the clean stage) takes the second loudnorm pass once on the final mix,
 * then a ceiling limiter just under -1 dBFS as a safety net. Plans without a measurement, i.e.
 * --no-clean, keep the original chain: mix, then limiter at 0.95.
 */
export function buildAudioFilter(
  plan: ShortPlan,
  sfxAssets: Record<SfxType, string>,
  sfxInputBase: number,
): { filter: string; sfxFiles: string[] } {
  const sfxFiles: string[] = [];
  const parts: string[] = [];
  const polish = plan.loudness !== undefined;
  const voice = polish ? `[0:a]highpass=f=${HIGHPASS_HZ}[voice];` : "";
  const mixLabels: string[] = [polish ? "voice" : "0:a"];
  plan.sfx.forEach((s, i) => {
    const inputIdx = sfxInputBase + i;
    sfxFiles.push(sfxAssets[s.type as SfxType]);
    const delayMs = Math.max(0, Math.round(s.at * 1000));
    const label = `sfx${i}`;
    parts.push(`[${inputIdx}:a]adelay=${delayMs}:all=1,volume=${s.gainDb}dB[${label}]`);
    mixLabels.push(label);
  });
  const tail = polish
    ? // 0.891 = -1.0 dBFS; level=0 keeps the limiter from re-normalizing what loudnorm just set
      `${loudnormPass2(plan.loudness as LoudnormMeasure)},alimiter=limit=0.89:attack=5:release=50:level=0`
    : "alimiter=limit=0.95:attack=5:release=50";
  let filter = voice + (parts.length ? parts.join(";") + ";" : "");
  if (plan.sfx.length > 0) {
    filter +=
      `${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amixed];` +
      `[amixed]${tail}[aout]`;
  } else {
    filter += `[${mixLabels[0]}]${tail}[aout]`;
  }
  return { filter, sfxFiles };
}

export function runFfmpegAssemble(
  plan: ShortPlan,
  framesDir: string,
  sfxAssets: Record<SfxType, string>,
  outPath: string,
): void {
  const shots = buildShots(plan);
  const shotFilters = shots.map((s, i) => shotFilter(s, plan, i));
  const concatInputs = shots.map((_, i) => `[s${i}]`).join("");
  const concatFilter = `${concatInputs}concat=n=${shots.length}:v=1:a=0[vconcat]`;
  // The sidecar captures at the display's backing scale (2160x3840 on a retina Mac); bring the overlay
  // back to the output size or overlay would show only its top-left quadrant.
  const overlayFilter = `[1:v]scale=${OUT_W}:${OUT_H}:flags=bicubic[ov];[vconcat][ov]overlay=format=auto[vout]`;
  const { filter: audioFilter, sfxFiles } = buildAudioFilter(plan, sfxAssets, 2);
  const filterComplex = [...shotFilters, concatFilter, overlayFilter, audioFilter].join(";");
  const framesPattern = path.join(framesDir, "%05d.png");

  const args = [
    "-i", plan.source.path,
    "-framerate", String(plan.output.fps),
    "-i", framesPattern,
    ...sfxFiles.flatMap((f) => ["-i", f]),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-r", String(plan.output.fps),
    "-fps_mode", "cfr",
    "-c:v", "h264_videotoolbox",
    "-b:v", "12M",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", plan.loudness ? "256k" : "192k",
    "-movflags", "+faststart",
    "-t", String(plan.source.durationSec),
    outPath,
  ];
  ffmpeg(args, "assemble");
}

// ---------------- Orchestration ----------------

export interface RenderShortResult {
  framesMs: number;
  encodeMs: number;
  workers: number;
  frames: number;
}

export async function renderShort(
  plan: ShortPlan,
  filmHtmlPath: string,
  outPath: string,
  workDir: string,
  opts?: { workers?: number; useDoubleRaf?: boolean; onStatus?: (msg: string) => void },
): Promise<RenderShortResult> {
  const workers = opts?.workers ?? DEFAULT_WORKERS;
  const useDoubleRaf = opts?.useDoubleRaf ?? DEFAULT_USE_DOUBLE_RAF;
  const onStatus = opts?.onStatus;
  const fps = plan.output.fps;
  const totalFrames = Math.round(plan.source.durationSec * fps);
  const framesDir = path.join(workDir, "frames");

  // ffmpeg-independent work started before/alongside frame capture: sfx asset
  // resolution is effectively free (vendor mp3s exist on disk) but kicking it
  // off first means it's never on render.ts's own critical path.
  const sfxDir = path.join(workDir, "sfx");
  const sfxAssets = resolveSfxAssets(sfxDir, onStatus);

  const capture = await captureFrames(filmHtmlPath, totalFrames, framesDir, workers, fps, useDoubleRaf, onStatus);

  const encodeStart = Date.now();
  runFfmpegAssemble(plan, framesDir, sfxAssets, outPath);
  const encodeMs = Date.now() - encodeStart;

  return { framesMs: capture.elapsedMs, encodeMs, workers: capture.workersUsed, frames: capture.frames };
}

// ---------------- CLI (dev/bench harness) ----------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function runBench(plan: ShortPlan, filmHtmlPath: string, workDir: string) {
  const sliceFrames = Math.min(300, Math.round(plan.source.durationSec * plan.output.fps));
  const counts = [4, 6, 8, 10];
  console.log(`\nWorker benchmark: ${sliceFrames} frames, useDoubleRaf=${DEFAULT_USE_DOUBLE_RAF}`);
  console.log("workers\tms\tfps");
  for (const w of counts) {
    const dir = path.join(workDir, `bench-${w}`);
    mkdirSync(dir, { recursive: true });
    const res = await captureFrames(filmHtmlPath, sliceFrames, dir, w, plan.output.fps, DEFAULT_USE_DOUBLE_RAF);
    const fps = (res.frames / (res.elapsedMs / 1000)).toFixed(1);
    console.log(`${w}\t${res.elapsedMs}\t${fps}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || !args.film || !args.work) {
    console.error(
      "Usage: render.ts --plan <plan.json> --film <film.html> --work <dir> [--out <out.mp4>] [--workers N] [--bench] [--double-raf]",
    );
    process.exit(1);
  }
  const plan: ShortPlan = JSON.parse(require("node:fs").readFileSync(String(args.plan), "utf8"));
  const filmHtmlPath = String(args.film);
  const workDir = path.resolve(String(args.work));
  mkdirSync(workDir, { recursive: true });

  if (args.bench) {
    await runBench(plan, filmHtmlPath, workDir);
    return;
  }

  const outPath = String(args.out || path.join(workDir, "out.mp4"));
  const workers = args.workers ? Number(args.workers) : undefined;
  const useDoubleRaf = Boolean(args["double-raf"]);
  const result = await renderShort(plan, filmHtmlPath, outPath, workDir, {
    workers,
    useDoubleRaf,
    onStatus: (m) => console.error(m),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
