// preview.ts — emits a standalone preview.html that plays the FINISHED EDIT LIVE in a
// browser: no ffmpeg, no frame rendering. It plays the SOURCE video with CSS crop/scale
// that reproduces render.ts Stage 7's ffmpeg filters exactly, with the built film.html
// overlay (captions/cards/progress bar) composited on top via a real transparent DOM
// layer (not a PNG sequence).
//
//   npx tsx src/short/preview.ts --plan <plan.json> --film <film.html> \
//     --src <source.mp4> --out <preview.html>
//
// Video source path convention: the <video> element's `src` is written as a path
// RELATIVE to the directory containing --out (e.g. "../src.mp4" or "src.mp4"), so the
// preview keeps working under file:// as long as preview.html and the source clip
// travel together at that same relative offset. If --src is on a different volume than
// --out (no relative path exists), the absolute filesystem path is written instead —
// note this may be blocked by some browsers' file:// sandboxing.
//
// Crop math: reproduces render.ts's `fullCropRect()` (base full crop, or the 1.10x
// face-centered punch-in variant) and `splitCropFilter()` (plan.geometry.split.crop)
// verbatim, then expresses ffmpeg's `crop=w:h:x:y,scale=OW:OH` as CSS: draw the WHOLE
// source video at (srcW*scaleX, srcH*scaleY) where scaleX=OW/crop.w, scaleY=OH/crop.h,
// offset by (-crop.x*scaleX, -crop.y*scaleY), inside an overflow:hidden box sized
// OWxOH. Because ffmpeg's `scale=W:H` (both dims given) always stretches to exactly
// WxH — never preserving aspect on its own — this CSS reproduction is PIXEL-EXACT for
// any crop rect, not an approximation. The only discrepancies vs. the real render are
// outside the geometry itself: (1) ffmpeg's scaler and the browser's <video> scaler use
// different resampling kernels, so fine detail can look very slightly different at the
// same crop; (2) frame timing — the browser decodes/displays source frames on its own
// clock rather than the fixed 30fps CFR timeline ffmpeg produces, so during scrubbing
// or playback the exact sub-frame image can differ by up to ~1 source frame. Neither
// affects the geometry (position/size) of the crop, only pixel-level rendering.

import fs from "node:fs";
import path from "node:path";
import type { ShortPlan } from "./types";
import { buildShots, fullCropRect, splitCropRect } from "./framing";

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

const HELP = `Usage: npx tsx src/short/preview.ts --plan <plan.json> --film <film.html> --src <source.mp4> --out <preview.html>

Emits a standalone preview.html that plays the finished edit live in a browser (no
ffmpeg, no frame rendering): the source video is CSS-cropped/scaled to reproduce
render.ts Stage 7's ffmpeg filters exactly, and the built film.html overlay
(captions/cards/progress bar) is composited on top as a live transparent DOM layer
driven by a requestAnimationFrame loop calling window.renderFrame(video.currentTime).

Video path convention: <video src> is written RELATIVE to the directory containing
--out. Keep preview.html and the source clip at that same relative offset (e.g. copy
or symlink both into one folder) so it resolves under file://. If no relative path is
possible (different volumes), an absolute path is written instead, which some browsers'
file:// sandboxing may refuse to load.

Controls: click the stage or press space to play/pause; drag the scrub bar to seek.
`;

/** Extracts the inner content of <body>...</body> from a self-contained film.html
 * built by film/buildFilm.ts (two <script> blocks: runtime+templates, then
 * window.__PLAN + Film.init call). We splice that markup into our own page, after
 * our own <div id="film"> placeholder, so Film.init() reuses OUR element (it only
 * creates its own div#film if one doesn't already exist) instead of appending a
 * second one to document.body. */
function extractFilmBody(filmHtml: string): string {
  const start = filmHtml.indexOf("<body>");
  const end = filmHtml.lastIndexOf("</body>");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("preview.ts: could not find <body>...</body> in film.html — was it built by film/buildFilm.ts?");
  }
  return filmHtml.slice(start + "<body>".length, end);
}

function relativeVideoSrc(outPath: string, srcPath: string): string {
  const outDir = path.dirname(path.resolve(outPath));
  const abs = path.resolve(srcPath);
  const rel = path.relative(outDir, abs);
  // path.relative returns an absolute-looking path (or one starting with "..\\..")
  // when there's no common root (e.g. different Windows drives) — in that case fall
  // back to the absolute path rather than emit something nonsensical.
  if (path.isAbsolute(rel)) return abs.split(path.sep).join("/");
  return rel.split(path.sep).join("/");
}

export function buildPreview(planPath: string, filmPath: string, srcPath: string, outPath: string): void {
  const plan: ShortPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const filmHtml = fs.readFileSync(filmPath, "utf8");
  const filmBody = extractFilmBody(filmHtml);
  const videoSrc = relativeVideoSrc(outPath, srcPath);

  // The same shot list render.ts feeds ffmpeg: layout, framing and every cut-driven punch-in flip.
  const shots = buildShots(plan).map((s) => ({
    start: s.startSec,
    end: s.endSec,
    layout: s.layout,
    crop: s.layout === "split" ? splitCropRect(plan, s.punchIn) : fullCropRect(plan, s.punchIn),
  }));

  // Everything the client-side script needs that isn't already inside window.__PLAN
  // (which film.html embeds itself) — kept separate and minimal on purpose, so the
  // preview's own crop math never depends on film.html's plan matching the one
  // passed via --plan (in practice they're built from the same plan, but the CLI
  // takes them as independent inputs).
  const meta = {
    source: { width: plan.source.width, height: plan.source.height, durationSec: plan.source.durationSec },
    beats: plan.beats.map((b) => ({ id: b.id, start: b.start, end: b.end, layout: b.layout, punchIn: b.punchIn })),
    shots,
  };
  const metaJson = JSON.stringify(meta).replace(/<\/script/gi, "<\\/script");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>short preview</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
  * { box-sizing: border-box; }
  #app-bg { position: fixed; inset: 0; background: #000; z-index: 0; }
  #viewport { position: fixed; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center; }
  /* 1080x1920 at native size; scaled down (never up) to fit the browser viewport via JS-computed transform. */
  #stage { position: relative; width: 1080px; height: 1920px; background: #000; overflow: hidden; transform-origin: center center; flex: none; }
  #video-container { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; background: #000; }
  #src-video { position: absolute; left: 0; top: 0; }
  /* film.html's own Film.init() sets #film's own inline position/size/background --
     this is just a safe placeholder before that runs. */
  #film { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }
  #controls { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; background: rgba(10,10,14,0.85); color: #eee; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
  #controls button { background: #24242c; color: #eee; border: 1px solid #3a3a44; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
  #controls button:hover { background: #303038; }
  #scrub { flex: 1; }
  #time { font-variant-numeric: tabular-nums; min-width: 96px; text-align: right; opacity: 0.8; }
  #perf { position: fixed; right: 10px; top: 8px; z-index: 2; color: #9c9; font: 11px/1.3 ui-monospace, monospace; opacity: 0.8; }
</style>
</head>
<body>
<div id="app-bg"></div>
<div id="viewport">
  <div id="stage">
    <div id="video-container"><video id="src-video" src="${videoSrc}" preload="auto" playsinline></video></div>
    <div id="film"></div>
  </div>
</div>
<div id="perf"></div>
<div id="controls">
  <button id="playBtn" type="button">Play</button>
  <input id="scrub" type="range" min="0" max="1000" value="0" step="1">
  <div id="time">0.00 / 0.00</div>
</div>

${filmBody}

<script>
/* ---- preview.ts runtime: crop math (render.ts Stage 7's shot list) + rAF loop ---- */
(function () {
  "use strict";
  var META = ${metaJson};

  // META.shots is render.ts's own shot list (framing.ts buildShots): layout, crop rect, and the
  // punch-in flip at every cut. Pick the shot covering t; clamp so a crop is always defined.
  function currentCropInfo(t) {
    var shots = META.shots;
    if (!shots.length) return { layout: "full", crop: null, key: -1 };
    var idx = shots.length - 1;
    if (t < shots[0].start) idx = 0;
    else for (var i = 0; i < shots.length; i++) {
      if (t >= shots[i].start && t < shots[i].end) { idx = i; break; }
    }
    return { layout: shots[idx].layout, crop: shots[idx].crop, key: idx };
  }

  var video = document.getElementById("src-video");
  var container = document.getElementById("video-container");
  var stage = document.getElementById("stage");
  var viewport = document.getElementById("viewport");
  var perfEl = document.getElementById("perf");

  var lastShot = null;

  // ffmpeg: [0:v]crop=w:h:x:y,scale=OW:OH. scale=OW:OH with BOTH dims given always
  // stretches to exactly OW x OH (no implicit aspect preservation), so drawing the
  // whole source at (srcW*OW/crop.w, srcH*OH/crop.h) and shifting by
  // (-crop.x*scaleX, -crop.y*scaleY) inside an OWxOH overflow:hidden box reproduces
  // it pixel-exactly for any crop rect.
  function applyCrop(info) {
    var srcW = META.source.width, srcH = META.source.height;
    var OW, OH, top;
    if (info.layout === "split") {
      OW = 1080; OH = 1080; top = 840;
    } else {
      OW = 1080; OH = 1920; top = 0;
    }
    container.style.left = "0px";
    container.style.top = top + "px";
    container.style.width = OW + "px";
    container.style.height = OH + "px";

    var c = info.crop || { x: 0, y: 0, w: srcW, h: srcH }; // no split.crop -> ffmpeg does bare scale=OW:OH (no crop)
    var scaleX = OW / c.w;
    var scaleY = OH / c.h;
    video.style.width = (srcW * scaleX) + "px";
    video.style.height = (srcH * scaleY) + "px";
    video.style.left = (-c.x * scaleX) + "px";
    video.style.top = (-c.y * scaleY) + "px";
  }

  // Fit the 1080x1920 stage into the viewport, centered, never upscaled beyond 1:1.
  function fitStage() {
    var vw = window.innerWidth, vh = Math.max(1, window.innerHeight - 46); // leave room for #controls
    var k = Math.min(vw / 1080, vh / 1920, 1);
    stage.style.transform = "scale(" + k + ")";
  }
  window.addEventListener("resize", fitStage);
  fitStage();

  // ---- playback controls ----
  var playBtn = document.getElementById("playBtn");
  var scrub = document.getElementById("scrub");
  var timeEl = document.getElementById("time");
  var seeking = false;

  function fmt(t) {
    if (!isFinite(t)) return "0.00";
    return t.toFixed(2);
  }
  function togglePlay() {
    if (video.paused) video.play(); else video.pause();
  }
  playBtn.addEventListener("click", togglePlay);
  stage.addEventListener("click", togglePlay);
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      togglePlay();
    }
  });
  video.addEventListener("play", function () { playBtn.textContent = "Pause"; });
  video.addEventListener("pause", function () { playBtn.textContent = "Play"; });
  scrub.addEventListener("input", function () {
    seeking = true;
    var dur = video.duration || META.source.durationSec || 1;
    video.currentTime = (Number(scrub.value) / 1000) * dur;
  });
  scrub.addEventListener("change", function () { seeking = false; });

  // ---- rAF loop: drives both the film overlay and the video crop from one clock ----
  var frameCount = 0, costSum = 0, lastPerfPrint = 0;
  function tick() {
    var t0 = performance.now();
    var t = video.currentTime;

    if (typeof window.renderFrame === "function") window.renderFrame(t);

    var info = currentCropInfo(t);
    if (info.key !== lastShot) {
      applyCrop(info);
      lastShot = info.key;
    }

    var dur = video.duration || META.source.durationSec || 0;
    if (!seeking) scrub.value = String(dur > 0 ? Math.round((t / dur) * 1000) : 0);
    timeEl.textContent = fmt(t) + " / " + fmt(dur);

    var cost = performance.now() - t0;
    frameCount++;
    costSum += cost;
    if (t0 - lastPerfPrint > 500) {
      var avg = costSum / Math.max(1, frameCount);
      perfEl.textContent = "renderFrame+crop: " + avg.toFixed(2) + "ms/frame (" + (avg / 33.3 * 100).toFixed(0) + "% of 33ms budget)";
      frameCount = 0; costSum = 0; lastPerfPrint = t0;
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Resume where the host left off. The editor rebuilds this file after every plan edit and
  // reloads the iframe, so without this you get thrown back to t=0 every time you nudge a card —
  // the one thing that makes an edit loop unusable. The host appends "#t=<seconds>"; we clamp it
  // to the media duration because a plan edit can shorten the film out from under a stale time.
  function seekFromHash() {
    var m = /[#&]t=([0-9.]+)/.exec(window.location.hash);
    if (!m) return;
    var want = parseFloat(m[1]);
    if (!isFinite(want) || want <= 0) return;
    var dur = isFinite(video.duration) ? video.duration : 0;
    video.currentTime = dur > 0 ? Math.min(want, Math.max(0, dur - 0.05)) : want;
  }

  // Initial paint before playback starts / before metadata loads.
  applyCrop(currentCropInfo(0));
  video.addEventListener("loadedmetadata", function () {
    seekFromHash();
    applyCrop(currentCropInfo(video.currentTime));
  });
})();
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.plan || !args.film || !args.src || !args.out) {
    console.error(HELP);
    process.exit(1);
  }
  buildPreview(String(args.plan), String(args.film), String(args.src), String(args.out));
  console.log("wrote", args.out);
}
