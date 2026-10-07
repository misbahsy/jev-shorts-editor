// Stage 6 (frame capture) + Stage 7 (ffmpeg assembly) for the `short/` spike.
//
// Stage 6: N sidecar PROCESSES, each opens its own 1080x1920 transparent WKWebView
// window against film.html, and steps a contiguous, disjoint range of the GLOBAL
// frame index (t = i/30), writing frames/%05d.png per frame.
//
// Stage 7: ONE ffmpeg invocation. Per-"shot" (maximal run of beats sharing layout +
// effective punchIn) trim/setpts/crop-or-pad/scale of the source video, concat all
// shots, overlay the captured PNG sequence (alpha), mix source audio with sfx, encode
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
import type { ShortPlan, Rect } from "./types";

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

const round30 = (t: number) => Math.round(t * 30) / 30;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Shot {
  startSec: number;
  endSec: number;
  layout: "full" | "split";
  punchIn: boolean;
}

export function buildShots(plan: ShortPlan): Shot[] {
  const shots: Shot[] = [];
  for (const beat of plan.beats) {
    const punchIn = beat.layout === "full" && beat.punchIn; // split never punches in
    const start = round30(beat.start);
    const end = round30(beat.end);
    const last = shots[shots.length - 1];
    if (last && last.layout === beat.layout && last.punchIn === punchIn && Math.abs(last.endSec - start) < 1e-6) {
      last.endSec = end;
    } else {
      shots.push({ startSec: start, endSec: end, layout: beat.layout, punchIn });
    }
  }
  return shots;
}

/**
 * Source-pixel crop rect for `full` layout, punched in 1.10x around the face center when needed.
 *
 * `plan.perception.face` is the RAW median box, which perceive.ts still fills with a neutral
 * placeholder when it could not reliably detect a face. Punching in on that placeholder frames an
 * arbitrary off-center region of a video that may have no speaker at all. geometry.ts's no-face
 * branch signals exactly this case by emitting a ZERO-SIZE face rect, so use the geometry rect's
 * size as the "is this a real detection" test (it is already in plan.json, unlike the newer
 * perception.hasReliableFace flag) and punch in on the existing crop's own center instead.
 */
export function fullCropRect(plan: ShortPlan, punchIn: boolean): Rect {
  const base = plan.geometry.full.crop;
  if (!punchIn) return base;
  const srcW = plan.source.width;
  const srcH = plan.source.height;
  const detected = plan.geometry.full.face.w > 0 && plan.geometry.full.face.h > 0;
  const faceCx = detected ? (plan.perception.face.x + plan.perception.face.w / 2) * srcW : base.x + base.w / 2;
  const faceCy = detected ? (plan.perception.face.y + plan.perception.face.h / 2) * srcH : base.y + base.h / 2;
  const w = base.w / 1.1;
  const h = base.h / 1.1;
  let x = faceCx - w / 2;
  let y = faceCy - h / 2;
  x = clamp(x, 0, srcW - w);
  y = clamp(y, 0, srcH - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function splitCropFilter(plan: ShortPlan): string {
  const c = (plan.geometry.split as { crop?: Rect }).crop;
  return c ? `crop=${c.w}:${c.h}:${c.x}:${c.y},` : "";
}

function shotFilter(shot: Shot, plan: ShortPlan, idx: number): string {
  const label = `s${idx}`;
  if (shot.layout === "split") {
    return (
      `[0:v]trim=start=${shot.startSec}:end=${shot.endSec},setpts=PTS-STARTPTS,` +
      `${splitCropFilter(plan)}scale=1080:1080,pad=1080:1920:0:840:0x0b0b0f[${label}]`
    );
  }
  const crop = fullCropRect(plan, shot.punchIn);
  return (
    `[0:v]trim=start=${shot.startSec}:end=${shot.endSec},setpts=PTS-STARTPTS,` +
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1080:1920[${label}]`
  );
}

function buildAudioFilter(
  plan: ShortPlan,
  sfxAssets: Record<SfxType, string>,
  sfxInputBase: number,
): { filter: string; sfxFiles: string[] } {
  const sfxFiles: string[] = [];
  const parts: string[] = [];
  const mixLabels: string[] = ["0:a"];
  plan.sfx.forEach((s, i) => {
    const inputIdx = sfxInputBase + i;
    sfxFiles.push(sfxAssets[s.type as SfxType]);
    const delayMs = Math.max(0, Math.round(s.at * 1000));
    const label = `sfx${i}`;
    parts.push(`[${inputIdx}:a]adelay=${delayMs}:all=1,volume=${s.gainDb}dB[${label}]`);
    mixLabels.push(label);
  });
  let filter = parts.length ? parts.join(";") + ";" : "";
  if (plan.sfx.length > 0) {
    filter +=
      `${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amixed];` +
      `[amixed]alimiter=limit=0.95:attack=5:release=50[aout]`;
  } else {
    filter += `[0:a]alimiter=limit=0.95:attack=5:release=50[aout]`;
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
  const overlayFilter = `[vconcat][1:v]overlay=format=auto[vout]`;
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
    "-b:a", "192k",
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
