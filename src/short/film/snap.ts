// snap.ts — single-frame visual QA tool for film.html.
// Usage:
//   npx tsx src/short/film/snap.ts --plan <plan.json> --t 0.5,3.9,12 --out <dir>
//
// Builds film.html (via buildFilm), captures a transparent 1080x1920 PNG of the overlay at each
// requested time through the sidecar seek contract, extracts the correctly-laid-out speaker frame
// from plan.source.path at that time (split: source square at y=840 on #0b0b0f; full: crop per
// plan.geometry.full.crop then scale to 1080x1920), composites overlay-over-speaker with ffmpeg,
// and writes snap_<t>.jpg into --out.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildFilm } from "./buildFilm";
import { startSidecar } from "../../render/sidecar";
import { seekExpr, READY_EXPR, DOUBLE_RAF_EXPR } from "../../render/seekScript";

interface Beat {
  id: string;
  start: number;
  end: number;
  layout: "full" | "split";
  [k: string]: unknown;
}
interface Plan {
  source: { path: string; durationSec: number };
  geometry: { full: { crop: { x: number; y: number; w: number; h: number } } };
  beats: Beat[];
  [k: string]: unknown;
}

function findActiveBeat(beats: Beat[], t: number): Beat | null {
  for (const b of beats) if (t >= b.start && t < b.end) return b;
  if (!beats.length) return null;
  return t < beats[0].start ? beats[0] : beats[beats.length - 1];
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status}): ${res.stderr?.toString().slice(-2000)}`);
  }
}

// Extracts the correctly-laid-out 1080x1920 speaker background frame at time t.
function extractBackground(plan: Plan, t: number, outPath: string) {
  const beat = findActiveBeat(plan.beats, t);
  const layout = beat ? beat.layout : "full";
  const src = plan.source.path;
  if (layout === "split") {
    // source square -> 1080x1080, placed at y=840 on a 1080x1920 canvas filled #0b0b0f
    const sc = (plan.geometry as any).split?.crop;
    const vf = (sc ? `crop=${sc.w}:${sc.h}:${sc.x}:${sc.y},` : "") + "scale=1080:1080,pad=1080:1920:0:840:0x0b0b0fff";
    run("ffmpeg", ["-y", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", vf, outPath]);
  } else {
    const c = plan.geometry.full.crop;
    const vf = `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=1080:1920`;
    run("ffmpeg", ["-y", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", vf, outPath]);
  }
}

function composite(bgPath: string, overlayPath: string, outPath: string) {
  run("ffmpeg", [
    "-y",
    "-i", bgPath,
    "-i", overlayPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[o]",
    "-map", "[o]",
    "-q:v", "3",
    outPath,
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || !args.t || !args.out) {
    console.error("Usage: snap.ts --plan <plan.json> --t 0.5,3.9,12 --out <dir>");
    process.exit(1);
  }
  const planPath = String(args.plan);
  const outDir = String(args.out);
  const times = String(args.t)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  const filmHtmlPath = path.join(outDir, "film.html");
  const t0 = Date.now();
  buildFilm(plan, filmHtmlPath);
  console.error(`[snap] built ${filmHtmlPath} in ${Date.now() - t0}ms`);

  const handle = startSidecar();
  const windowId = 1;
  try {
    await handle.request("create", windowId, { width: 1080, height: 1920, show: false, transparent: true, title: "film-snap" });
    await handle.request("setBackgroundColor", windowId, { color: "transparent" });
    await handle.request("loadFile", windowId, { path: path.resolve(filmHtmlPath) });
    await handle.request("evaluate", windowId, { source: READY_EXPR });
    await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });

    for (const t of times) {
      const tStart = Date.now();
      await handle.request("evaluate", windowId, { source: seekExpr(t) });
      await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });
      const cap = await handle.request("capture", windowId, {});
      const overlayPath = path.join(outDir, `overlay_${t}.png`);
      fs.writeFileSync(overlayPath, Buffer.from(cap.png as string, "base64"));

      const bgPath = path.join(outDir, `bg_${t}.png`);
      extractBackground(plan, t, bgPath);

      const outPath = path.join(outDir, `snap_${t}.jpg`);
      composite(bgPath, overlayPath, outPath);

      console.error(`[snap] t=${t} -> ${outPath} (${Date.now() - tStart}ms)`);
    }
    await handle.request("destroy", windowId, {});
  } finally {
    handle.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
