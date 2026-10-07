// CLI orchestrator for the short editor: talking-head clip -> finished 1080x1920
// short, end-to-end. Runs planShort -> buildFilm -> renderShort, unless --plan/--film
// point at pre-built artifacts (used for fast iteration on render.ts against the fixture
// while plan.ts / film/buildFilm.ts are developed by other agents in parallel).
//
//   npx tsx src/short/auto.ts --in <src.mp4> --out <out.mp4> [--work <dir>] \
//     [--plan <plan.json>] [--film <film.html>] [--workers N] [--title "..."] \
//     [--preview <preview.html>] [--no-export] [--progress-json]
//
// planShort and buildFilm are loaded via dynamic import() so this file still runs
// (in --plan/--film mode) even if plan.ts/film/buildFilm.ts don't exist yet.
//
// HOST INTEGRATION CONTRACT (for apps that drive this CLI as a child process).
// With --progress-json, stdout carries ONLY newline-delimited JSON events and all
// human logging moves to stderr, so a host can parse stdout without heuristics:
//
//   {"stage":"probe"|"analyze"|"decide"|"structure"|"copy"|"film"|"preview"
//            |"frames"|"encode"|"done"|"error",
//    "label": "<human-readable line>",
//    "pct"?: 0..1,                  // present on "frames"
//    "previewPath"?: "<abs path>",  // present on "preview" and "done"
//    "videoPath"?:   "<abs path>",  // present on "done" unless --no-export
//    "planPath"?:    "<abs path>",  // present on "done"
//    "error"?:       "<message>"}   // present on "error"
//
// The "preview" event is the load-bearing one: it fires once the film page exists,
// which is ~15s in, and the short is fully watchable from that moment. Frame capture
// and encoding (a further ~50s) only produce a downloadable file, so a host should
// show the preview immediately and treat --no-export/export as a background opt-in.
//
// Sub-stage progress during planShort is derived by WATCHING THE ARTIFACTS IT WRITES
// (decisions.json -> beats.json -> structure.json -> copy.json -> plan.json) rather
// than by instrumenting plan.ts. That keeps this contract decoupled from planning
// internals: the filenames are already that module's documented output.

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ShortPlan } from "./types";
import { renderShort, DEFAULT_WORKERS } from "./render";

interface ProgressEvent {
  stage:
    | "probe" | "analyze" | "decide" | "structure" | "copy" | "film"
    | "preview" | "frames" | "encode" | "done" | "error";
  label: string;
  pct?: number;
  previewPath?: string;
  videoPath?: string;
  planPath?: string;
  error?: string;
  timings?: Record<string, number>;
}

/** Emits the JSON event stream on stdout when --progress-json, otherwise a no-op. */
function makeEmitter(enabled: boolean): (e: ProgressEvent) => void {
  if (!enabled) return () => {};
  return (e: ProgressEvent) => process.stdout.write(`${JSON.stringify(e)}\n`);
}

/**
 * Polls workDir for the artifacts planShort writes in order, emitting one event the
 * first time each appears. Returns a stop function. Deliberately tolerant: a missing
 * or renamed artifact just means that sub-stage never reports, never a crash.
 */
function watchPlanArtifacts(workDir: string, emit: (e: ProgressEvent) => void): () => void {
  const steps: { file: string; stage: ProgressEvent["stage"]; label: string }[] = [
    { file: "decisions.json", stage: "decide", label: "Jev picked the style and the card for each beat" },
    { file: "structure.json", stage: "structure", label: "Laying out the shots" },
    { file: "copy.json", stage: "copy", label: "Writing the on-screen text" },
    { file: "plan.json", stage: "film", label: "Building the film" },
  ];
  const seen = new Set<string>();
  const timer = setInterval(() => {
    for (const s of steps) {
      if (seen.has(s.file)) continue;
      if (existsSync(path.join(workDir, s.file))) {
        seen.add(s.file);
        emit({ stage: s.stage, label: s.label });
      }
    }
  }, 150);
  timer.unref?.();
  return () => clearInterval(timer);
}

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

interface TimingRow {
  stage: string;
  ms: number;
}

function printTimingTable(rows: TimingRow[]) {
  // plan:* rows are a breakdown of plan:totalMs (and transcribe ‖ perceive overlap) — don't double count
  const total = rows.filter((r) => !r.stage.startsWith("plan:") || r.stage === "plan:totalMs").reduce((a, r) => a + r.ms, 0);
  const nameWidth = Math.max(6, ...rows.map((r) => r.stage.length));
  console.log("");
  console.log("stage".padEnd(nameWidth) + "  ms");
  console.log("-".repeat(nameWidth + 10));
  for (const r of rows) {
    console.log(r.stage.padEnd(nameWidth) + "  " + String(Math.round(r.ms)));
  }
  console.log("-".repeat(nameWidth + 10));
  console.log("TOTAL".padEnd(nameWidth) + "  " + String(Math.round(total)));
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in || !args.out) {
    console.error(
      "Usage: auto.ts --in <src.mp4> --out <out.mp4> [--work <dir>] [--plan <plan.json>] " +
        "[--film <film.html>] [--workers N] [--title \"...\"] [--preview <preview.html>] " +
        "[--no-export] [--progress-json]",
    );
    process.exit(1);
  }

  const srcPath = path.resolve(String(args.in));
  const outPath = path.resolve(String(args.out));
  const workDir = path.resolve(String(args.work || path.join(path.dirname(outPath), ".short-work")));
  mkdirSync(workDir, { recursive: true });

  const jsonMode = Boolean(args["progress-json"]);
  const emit = makeEmitter(jsonMode);
  // In JSON mode stdout is the event channel, so the human report moves to stderr.
  const say = jsonMode ? (s: string) => process.stderr.write(`${s}\n`) : (s: string) => console.log(s);

  // --preview defaults ON in JSON mode: a host integration always wants the watchable
  // page, and building it is ~milliseconds. Explicit --preview <path> overrides the location.
  const previewPath =
    typeof args.preview === "string"
      ? path.resolve(args.preview)
      : args.preview || jsonMode
        ? path.join(workDir, "preview.html")
        : null;
  const wantExport = !args["no-export"];

  const wallStart = Date.now();
  const rows: TimingRow[] = [];
  emit({ stage: "probe", label: "Reading the video" });

  // Optional warm-up: spawn sidecar worker processes at the very start (during
  // planning) so their WKWebView process startup cost is paid concurrently with
  // Jev/planning work instead of serially before frame capture. Cheap to attempt;
  // if the sidecar binary isn't resolvable yet we just skip it silently.
  let warmHandles: { close: () => void }[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startSidecar } = await import("../render/sidecar");
    const workers = args.workers ? Number(args.workers) : DEFAULT_WORKERS;
    warmHandles = Array.from({ length: workers }, () => startSidecar());
  } catch {
    warmHandles = [];
  }

  let plan: ShortPlan;
  let planPath = path.join(workDir, "plan.json");
  if (args.plan) {
    const t0 = Date.now();
    planPath = path.resolve(String(args.plan));
    plan = JSON.parse(readFileSync(planPath, "utf8"));
    rows.push({ stage: "plan (loaded)", ms: Date.now() - t0 });
  } else {
    const t0 = Date.now();
    // Drop artifacts from an earlier run in this workDir so the watcher reports THIS
    // run's progress instead of firing every stage instantly off stale files.
    for (const f of ["decisions.json", "structure.json", "copy.json", "plan.json"]) {
      try {
        rmSync(path.join(workDir, f));
      } catch {
        /* absent is the normal case */
      }
    }
    emit({ stage: "analyze", label: "Transcribing and reading the frames" });
    const stopWatch = watchPlanArtifacts(workDir, emit);
    const { planShort } = await import("./plan");
    try {
      plan = await planShort(srcPath, workDir, (args.title as string) || undefined);
    } finally {
      stopWatch();
    }
    const planMs = Date.now() - t0;
    if (plan.timings) {
      for (const [stage, ms] of Object.entries(plan.timings)) rows.push({ stage: `plan:${stage}`, ms: Number(ms) });
    } else {
      rows.push({ stage: "plan", ms: planMs });
    }
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
  }

  let filmHtmlPath: string;
  if (args.film) {
    filmHtmlPath = path.resolve(String(args.film));
    rows.push({ stage: "film (existing)", ms: 0 });
  } else {
    const t0 = Date.now();
    const { buildFilm } = await import("./film/buildFilm");
    filmHtmlPath = path.join(workDir, "film.html");
    buildFilm(plan, filmHtmlPath);
    rows.push({ stage: "film", ms: Date.now() - t0 });
  }

  // The short is fully watchable from here: preview.html plays film.html's transparent
  // overlay over the source <video> with ffmpeg's per-shot crop reproduced in CSS.
  // Build it BEFORE frame capture so a host can show it ~50s earlier than the mp4.
  if (previewPath) {
    const t0 = Date.now();
    const { buildPreview } = await import("./preview");
    buildPreview(planPath, filmHtmlPath, srcPath, previewPath);
    rows.push({ stage: "preview", ms: Date.now() - t0 });
    emit({ stage: "preview", label: "Ready to watch", previewPath });
    say(`preview: ${previewPath}`);
  }

  // Close the warm-up sidecars now: renderShort spins up its own fresh set for the
  // real chunked capture (fixed windowId=1 per handle), so these are pure warm-up.
  for (const h of warmHandles) {
    try {
      h.close();
    } catch {
      /* ignore */
    }
  }

  if (!wantExport) {
    const totalWallMs = Date.now() - wallStart;
    if (!jsonMode) printTimingTable(rows);
    say(`wall clock: ${(totalWallMs / 1000).toFixed(2)}s (no export)`);
    emit({
      stage: "done",
      label: "Short is ready to watch",
      previewPath: previewPath ?? undefined,
      planPath,
      timings: Object.fromEntries(rows.map((r) => [r.stage, r.ms])),
    });
    return;
  }

  const workers = args.workers ? Number(args.workers) : undefined;
  const totalChunks = workers ?? DEFAULT_WORKERS;
  let chunksDone = 0;
  const render = await renderShort(plan, filmHtmlPath, outPath, workDir, {
    workers,
    onStatus: (m) => {
      process.stderr.write(`[render] ${m}\n`);
      if (/^chunk \d+: frames .* done$/.test(m)) {
        chunksDone++;
        emit({
          stage: "frames",
          label: `Rendering frames (${chunksDone}/${totalChunks})`,
          pct: Math.min(1, chunksDone / totalChunks),
        });
      }
    },
  });
  rows.push({ stage: "frames", ms: render.framesMs });
  rows.push({ stage: "encode", ms: render.encodeMs });
  emit({ stage: "encode", label: "Encoding the MP4" });

  const totalWallMs = Date.now() - wallStart;
  if (!jsonMode) printTimingTable(rows);
  say(`workers used: ${render.workers}, frames: ${render.frames}`);
  say(`wall clock: ${(totalWallMs / 1000).toFixed(2)}s`);
  say(`output: ${outPath}`);

  const timingsOut = {
    rows: Object.fromEntries(rows.map((r) => [r.stage, r.ms])),
    workers: render.workers,
    frames: render.frames,
    totalWallMs,
  };
  writeFileSync(path.join(workDir, "timings.json"), JSON.stringify(timingsOut, null, 2));

  emit({
    stage: "done",
    label: "Short exported",
    videoPath: outPath,
    previewPath: previewPath ?? undefined,
    planPath,
    timings: timingsOut.rows,
  });
}

if (require.main === module) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    // The error event has to reach stdout too: a host parsing the JSON stream should
    // not have to scrape stderr to learn the run failed.
    if (process.argv.includes("--progress-json")) {
      process.stdout.write(`${JSON.stringify({ stage: "error", label: "Generation failed", error: message })}\n`);
    }
    process.exit(1);
  });
}
