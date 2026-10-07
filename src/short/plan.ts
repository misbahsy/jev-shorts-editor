/**
 * Orchestrator: transcribe ‖ perceive -> decide -> assembleStructure -> fillCopy -> finalize.
 * Structure (layout/template/effects/transition/punchIn) is fully decided BEFORE copy is
 * generated, so fillCopy only ever writes fields for the template a beat will keep — see
 * structure.ts for why. Writes every intermediate artifact + plan.json into workDir, with
 * per-stage timings (transcribe/perceive run in parallel but are timed separately).
 *
 * CLI: npx tsx src/short/plan.ts --in <mp4> --work <dir> [--title "..."]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transcribe } from "./transcribe";
import { perceive } from "./perceive";
import { decide, buildBeats } from "./decide";
import { assembleStructure } from "./structure";
import { holdMerge, extendOverDeadRuns } from "./hold";
import { fillCopy } from "./copy";
import { finalize } from "./finalize";
import { computeGeometry } from "./geometry";
import type { ShortPlan } from "./types";

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

export async function planShort(srcPath: string, workDir: string, title = "Untitled"): Promise<ShortPlan> {
  mkdirSync(workDir, { recursive: true });
  const timings: Record<string, number> = {};
  const t0 = Date.now();

  const probe = probeSource(srcPath);
  timings.probeMs = Date.now() - t0;

  // transcribe ‖ perceive — run concurrently but time each independently
  let transcribeMs = 0;
  let perceiveMs = 0;
  const [words, perception] = await Promise.all([
    (async () => {
      const t = Date.now();
      const r = await transcribe(srcPath, workDir);
      transcribeMs = Date.now() - t;
      return r;
    })(),
    (async () => {
      const t = Date.now();
      const r = await perceive(srcPath, workDir);
      perceiveMs = Date.now() - t;
      return r;
    })(),
  ]);
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
  const structure = assembleStructure(beats, decisions);
  timings.structureMs = Date.now() - tStructure;
  writeFileSync(join(workDir, "structure.json"), JSON.stringify(structure, null, 2));

  const tCopy = Date.now();
  const copy = await fillCopy(beats, structure, words, meta);
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
    source: { path: srcPath, durationSec: probe.durationSec, width: probe.width, height: probe.height, fps: probe.fps },
  });
  timings.finalizeMs = Date.now() - tFinalize;
  timings.totalMs = Date.now() - t0;

  plan.timings = timings;
  writeFileSync(join(workDir, "plan.json"), JSON.stringify(plan, null, 2));

  return plan;
}

function parseArgs(argv: string[]): { in: string; work: string; title?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.in = argv[++i];
    else if (a === "--work") out.work = argv[++i];
    else if (a === "--title") out.title = argv[++i];
  }
  if (!out.in || !out.work) {
    console.error("usage: plan.ts --in <mp4> --work <dir> [--title \"...\"]");
    process.exit(1);
  }
  return out as { in: string; work: string; title?: string };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  planShort(args.in, args.work, args.title ?? "Untitled")
    .then(plan => {
      console.log(`Wrote plan.json: ${plan.beats.length} beats, ${plan.sfx.length} sfx, timings=${JSON.stringify(plan.timings)}`);
    })
    .catch(err => {
      console.error("planShort failed:", err);
      process.exit(1);
    });
}
