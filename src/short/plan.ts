/**
 * Orchestrator: [clean] -> transcribe ‖ perceive -> decide -> assembleStructure -> fillCopy -> finalize.
 * Structure (layout/template/effects/transition/punchIn) is fully decided BEFORE copy is
 * generated, so fillCopy only ever writes fields for the template a beat will keep — see
 * structure.ts for why. Writes every intermediate artifact + plan.json into workDir, with
 * per-stage timings (transcribe/perceive run in parallel but are timed separately).
 *
 * With the clean stage on (the default) the raw clip is transcribed once, retakes / dead air /
 * fillers are cut into work/clean.mp4, and every later stage sees clean.mp4 and the remapped
 * words, so output time still equals source time downstream. --no-clean keeps the raw clip.
 *
 * CLI: npx tsx src/short/plan.ts --in <mp4> --work <dir> [--title "..."] [--no-clean]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transcribe } from "./transcribe";
import { perceive, type Perception } from "./perceive";
import { decide, buildBeats } from "./decide";
import { assembleStructure } from "./structure";
import { holdMerge, extendOverDeadRuns } from "./hold";
import { fillCopy } from "./copy";
import { finalize } from "./finalize";
import { computeGeometry } from "./geometry";
import { cleanSource, type CleanResult } from "./clean";
import { DEFAULT_HOOK_STYLE, applyHookStructure, buildHookPlan, headTopFromFace, hookOpeningText, leakTimes, pickHookEnd } from "./hook";
import { buildCutout } from "./matte";
import type { ShortPlan } from "./types";
import type { Word } from "./transcribe";

interface Probe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

function probeSource(srcPath: string): Probe {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate:format=duration",
      "-of",
      "json",
      srcPath,
    ],
    { encoding: "utf8" },
  );
  const data = JSON.parse(out) as {
    streams: { width: number; height: number; r_frame_rate: string }[];
    format: { duration: string };
  };
  const stream = data.streams[0];
  const [num, den] = stream.r_frame_rate.split("/").map(Number);
  return {
    durationSec: Number(data.format.duration),
    width: stream.width,
    height: stream.height,
    fps: den ? num / den : num,
  };
}

export interface PlanOptions {
  /** Run the clean stage (default true). false = the original behavior, raw clip in and out. */
  clean?: boolean;
  /** Build the opening hook (giant title behind the speaker) and light leaks (default true). */
  hook?: boolean;
  /** Progress hook for the clean stage's own log lines. */
  log?: (m: string) => void;
}

export async function planShort(srcPath: string, workDir: string, title = "Untitled", options: PlanOptions = {}): Promise<ShortPlan> {
  mkdirSync(workDir, { recursive: true });
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const useClean = options.clean !== false;

  let probe = probeSource(srcPath);
  timings.probeMs = Date.now() - t0;

  let words: Word[];
  let perception: Perception;
  let clean: CleanResult | null = null;
  let perceiveSrc = srcPath;
  let perceiveMs = 0;
  let transcribeMs = 0;

  if (useClean) {
    // the raw clip is transcribed once (inside cleanSource); perceive then runs on the cleaned clip
    const tClean = Date.now();
    clean = await cleanSource(srcPath, workDir, { log: options.log });
    timings.cleanMs = Date.now() - tClean;
    words = clean.words;
    perceiveSrc = clean.cleanPath;
    probe = { durationSec: clean.durationSec, width: clean.width, height: clean.height, fps: clean.fps };
    const tPerceive = Date.now();
    perception = await perceive(perceiveSrc, workDir);
    perceiveMs = Date.now() - tPerceive;
  } else {
    // transcribe ‖ perceive — run concurrently but time each independently
    let tm = 0;
    let pm = 0;
    const [w, p] = await Promise.all([
      (async () => {
        const t = Date.now();
        const r = await transcribe(srcPath, workDir);
        tm = Date.now() - t;
        return r;
      })(),
      (async () => {
        const t = Date.now();
        const r = await perceive(srcPath, workDir);
        pm = Date.now() - t;
        return r;
      })(),
    ]);
    words = w;
    perception = p;
    transcribeMs = tm;
    perceiveMs = pm;
  }
  timings.transcribeMs = transcribeMs;
  timings.perceiveMs = perceiveMs;

  const meta = { title, sceneDescription: perception.description };

  const tDecide = Date.now();
  const rawDecisions = await decide(words, perception, meta);
  timings.decideMs = Date.now() - tDecide;
  writeFileSync(join(workDir, "decisions.json"), JSON.stringify(rawDecisions, null, 2));

  // same template on adjacent beats = one idea -> hold one card across them
  const held = holdMerge(buildBeats(words), rawDecisions);
  // coverage-floor remedy #1: extend a card across a following dead run before structure.ts ever
  // considers promoting a (possibly contentless) beat to cover it -- see hold.ts/structure.ts
  const { beats, decisions } = extendOverDeadRuns(held.beats, held.decisions);
  writeFileSync(join(workDir, "beats.json"), JSON.stringify(beats, null, 2));

  const tStructure = Date.now();
  let structure = assembleStructure(beats, decisions);
  // the opening hook owns the first seconds: full framing there, no card under it
  const useHook = options.hook !== false;
  const hookStyle = decisions.global.hookStyle?.choice ?? DEFAULT_HOOK_STYLE;
  const hookEnd = pickHookEnd(words, beats.map(b => b.start), probe.durationSec);
  let visualFrom: Record<string, number> = {};
  if (useHook) {
    const applied = applyHookStructure(structure, beats, decisions.beats, hookEnd);
    structure = applied.structure;
    visualFrom = applied.visualFrom;
  }
  timings.structureMs = Date.now() - tStructure;
  writeFileSync(join(workDir, "structure.json"), JSON.stringify(structure, null, 2));

  const tCopy = Date.now();
  const opening = hookOpeningText(words, hookEnd);
  const copy = await fillCopy(beats, structure, words, meta, useHook ? { opening, style: hookStyle } : undefined);
  timings.copyMs = Date.now() - tCopy;
  writeFileSync(join(workDir, "copy.json"), JSON.stringify(copy, null, 2));

  const tGeometry = Date.now();
  const geometry = computeGeometry(perception.face, probe.width, probe.height, perception.hasReliableFace);
  timings.geometryMs = Date.now() - tGeometry;

  const tFinalize = Date.now();
  const plan = finalize({
    words,
    beats,
    structure,
    perception,
    geometry,
    decisions,
    copy,
    source: { path: perceiveSrc, durationSec: probe.durationSec, width: probe.width, height: probe.height, fps: probe.fps },
  });
  if (clean) {
    plan.cuts = clean.cutPoints;
    plan.loudness = clean.loudness;
    plan.clean = clean.stats;
  }
  timings.finalizeMs = Date.now() - tFinalize;

  if (useHook) {
    for (const b of plan.beats) if (visualFrom[b.id] !== undefined && b.visual) b.visualFrom = visualFrom[b.id];
    // the person cut-out needs the final layouts and cuts, so it runs after finalize
    const tCut = Date.now();
    const faceReliable = perception.hasReliableFace !== false;
    const cut = faceReliable
      ? buildCutout(plan, workDir, hookEnd, { quality: (process.env.JEV_MATTE_QUALITY as "fast" | "balanced" | "accurate" | undefined) ?? "balanced" })
      : { ok: false, frames: 0, reason: "no reliable face for a cut-out", ms: { extract: 0, matte: 0, merge: 0, total: 0 }, quality: "balanced" as const };
    timings.cutoutMs = Date.now() - tCut;
    timings.cutoutExtractMs = cut.ms.extract;
    timings.cutoutMatteMs = cut.ms.matte;
    timings.cutoutMergeMs = cut.ms.merge;
    options.log?.(cut.ok ? `hook cut-out: ${cut.frames} frames in ${timings.cutoutMs} ms` : `hook cut-out unavailable (${cut.reason}); front fallback`);
    plan.hook = buildHookPlan({
      style: hookStyle,
      copy: copy.hook,
      opening,
      endSec: hookEnd,
      cutout: cut,
      faceTopFrac: geometry.full.face.h > 0 ? geometry.full.face.y / plan.output.height : 0.2,
      headTopFrac: geometry.full.face.h > 0 ? headTopFromFace(geometry.full.face, plan.output.height) : undefined,
    });
    plan.fx = { leaks: leakTimes(plan.beats, hookEnd) };
  }
  timings.totalMs = Date.now() - t0;

  plan.timings = timings;
  writeFileSync(join(workDir, "plan.json"), JSON.stringify(plan, null, 2));

  return plan;
}

function parseArgs(argv: string[]): { in: string; work: string; title?: string; clean: boolean } {
  const out: Record<string, string> = {};
  let clean = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.in = argv[++i];
    else if (a === "--work") out.work = argv[++i];
    else if (a === "--title") out.title = argv[++i];
    else if (a === "--no-clean") clean = false;
  }
  if (!out.in || !out.work) {
    console.error("usage: plan.ts --in <mp4> --work <dir> [--title \"...\"] [--no-clean]");
    process.exit(1);
  }
  return { ...(out as { in: string; work: string; title?: string }), clean };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  planShort(args.in, args.work, args.title ?? "Untitled", { clean: args.clean })
    .then(plan => {
      console.log(`Wrote plan.json: ${plan.beats.length} beats, ${plan.sfx.length} sfx, timings=${JSON.stringify(plan.timings)}`);
    })
    .catch(err => {
      console.error("planShort failed:", err);
      process.exit(1);
    });
}
