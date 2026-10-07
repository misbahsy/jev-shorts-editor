// Writes a contract-shaped ShortPlan fixture (render-plan.json) plus a dummy,
// self-contained film.html to the scratch dir, so render.ts (stages 6-7) can be
// developed and tested before plan.ts / buildFilm.ts land from the other agents.
//
// Usage:
//   npx tsx src/short/fixtures/renderFixture.ts --src <src.mp4> --out <scratchDir>
//
// Writes:
//   <scratchDir>/fixtures/render-plan.json
//   <scratchDir>/fixtures/film.html

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ffprobeDuration } from "../../render/ffutil";
import type { ShortPlan, Beat } from "../types";
import type { SfxType } from "../../render/sfx";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const round30 = (t: number) => Math.round(t * 30) / 30;

interface BeatSpec {
  layout: "full" | "split";
  punchIn: boolean;
}

// 12 beats grouped into runs (some multi-beat) so shot-merging logic in render.ts
// (maximal run of same layout+punchIn) gets exercised, not just strict alternation.
const BEAT_SPECS: BeatSpec[] = [
  { layout: "full", punchIn: false },
  { layout: "full", punchIn: false }, // run of 2
  { layout: "split", punchIn: false },
  { layout: "split", punchIn: false }, // run of 2
  { layout: "full", punchIn: false },
  { layout: "full", punchIn: true }, // punch-in shot boundary
  { layout: "split", punchIn: false },
  { layout: "full", punchIn: false },
  { layout: "full", punchIn: true },
  { layout: "full", punchIn: true }, // run of 2, punched in
  { layout: "split", punchIn: false },
  { layout: "full", punchIn: false },
];

const SFX_TYPES: SfxType[] = ["whoosh", "pop", "ding", "riser", "impact"];

export function buildFixturePlan(srcPath: string, durationSec: number): ShortPlan {
  const n = BEAT_SPECS.length;
  const beats: Beat[] = [];
  for (let i = 0; i < n; i++) {
    const rawStart = (i / n) * durationSec;
    const rawEnd = i === n - 1 ? durationSec : ((i + 1) / n) * durationSec;
    const start = round30(rawStart);
    const end = i === n - 1 ? round30(durationSec) : round30(rawEnd);
    const spec = BEAT_SPECS[i];
    beats.push({
      id: `b${i + 1}`,
      start,
      end,
      text: `Fixture beat ${i + 1} line of dialogue.`,
      wordRange: [0, 0],
      layout: spec.layout,
      visual: null,
      transitionIn: i === 0 ? "hard_cut" : spec.punchIn ? "flash" : "hard_cut",
      punchIn: spec.punchIn,
    });
  }
  // make sure beats are perfectly contiguous after rounding (avoid tiny gaps/overlaps)
  for (let i = 1; i < beats.length; i++) beats[i].start = beats[i - 1].end;
  beats[beats.length - 1].end = round30(durationSec);

  const sfx = SFX_TYPES.map((type, i) => ({
    type,
    at: round30(((i + 0.5) / SFX_TYPES.length) * durationSec),
    gainDb: -6,
  }));

  // Face box in SOURCE-normalized coords, chosen so it's consistent with the
  // fixed geometry below (split.face = full.face-in-source-px + (0, panelHeight)).
  const face = { x: 358 / 1080, y: 145 / 1080, w: 321 / 1080, h: 402 / 1080 };
  const secondsCount = Math.ceil(durationSec) + 1;

  const plan: ShortPlan = {
    source: { path: srcPath, durationSec, width: 1080, height: 1080, fps: 30 },
    output: { width: 1080, height: 1920, fps: 30 },
    perception: {
      face,
      facePerSecond: Array.from({ length: secondsCount }, () => ({ ...face })),
      description: "Fixture: person talking to camera, medium shot, plain background.",
    },
    geometry: {
      full: {
        crop: { x: 214, y: 0, w: 608, h: 1080 },
        face: { x: 256, y: 257, w: 571, h: 714 },
        captionY: 1130,
        visualRect: { x: 60, y: 1260, w: 900, h: 320 },
      },
      split: {
        speaker: { x: 0, y: 840, w: 1080, h: 1080 },
        panel: { x: 0, y: 0, w: 1080, h: 840 },
        face: { x: 358, y: 985, w: 321, h: 402 },
        captionY: 1480,
      },
    },
    style: { family: "clean_swiss", accent: "blue", captionStyle: "word_pop", energy: 1, progressBar: true },
    words: [],
    beats,
    sfx,
  };
  return plan;
}

function buildFilmHtml(plan: ShortPlan): string {
  const beatsForJs = plan.beats.map((b) => ({
    id: b.id,
    start: b.start,
    end: b.end,
    layout: b.layout,
    punchIn: b.punchIn,
  }));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0; padding: 0;
    width: 1080px; height: 1920px;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, "SF Pro Display", Helvetica, Arial, sans-serif;
  }
  #panel {
    position: absolute; left: 0; top: 0; width: 1080px; height: 840px;
    background: #0b0b0f;
    display: none;
  }
  #counter {
    position: absolute; left: 60px; width: 960px;
    text-align: center; color: #ffffff;
    font-size: 46px; font-weight: 700;
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
  }
  #accent {
    position: absolute; width: 220px; height: 14px;
    background: #3b82f6; border-radius: 7px;
  }
</style>
</head>
<body>
<div id="panel"></div>
<div id="counter"></div>
<div id="accent"></div>
<script>
  var BEATS = ${JSON.stringify(beatsForJs)};
  var FPS = ${plan.output.fps};
  var panelEl = document.getElementById('panel');
  var counterEl = document.getElementById('counter');
  var accentEl = document.getElementById('accent');

  function findBeat(t) {
    for (var i = 0; i < BEATS.length; i++) {
      var b = BEATS[i];
      if (t >= b.start && t < b.end) return b;
    }
    return BEATS[BEATS.length - 1];
  }

  // Pure function of t: no timers, no CSS transitions, no Math.random.
  window.renderFrame = function (t) {
    var b = findBeat(t);
    var isSplit = b.layout === 'split';
    panelEl.style.display = isSplit ? 'block' : 'none';

    var frame = Math.round(t * FPS);
    counterEl.textContent = 'frame ' + frame + '  t=' + t.toFixed(3) + 's  beat ' + b.id +
      ' (' + b.layout + (b.punchIn ? ' PUNCH' : '') + ')';
    // under-chin safe area for full layout; inside panel for split.
    counterEl.style.top = isSplit ? '380px' : '1330px';

    var sweep = (t % 2) / 2; // 0..1 every 2s, so frame ordering errors are visible
    accentEl.style.left = (sweep * (1080 - 220)) + 'px';
    accentEl.style.top = isSplit ? '120px' : '1500px';
  };

  window.__filmReady = true;
</script>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const srcPath = args.src ? path.resolve(args.src) : "";
  const outDir = args.out ? path.resolve(args.out) : "";
  if (!srcPath || !outDir) {
    console.error("Usage: renderFixture.ts --src <src.mp4> --out <scratchDir>");
    process.exit(1);
  }
  const durationSec = ffprobeDuration(srcPath);
  const plan = buildFixturePlan(srcPath, durationSec);
  const fixturesDir = path.join(outDir, "fixtures");
  mkdirSync(fixturesDir, { recursive: true });
  const planPath = path.join(fixturesDir, "render-plan.json");
  const filmPath = path.join(fixturesDir, "film.html");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  writeFileSync(filmPath, buildFilmHtml(plan));
  console.log(`wrote ${planPath}`);
  console.log(`wrote ${filmPath}`);
  console.log(`durationSec=${durationSec.toFixed(3)} frames=${Math.round(durationSec * 30)} beats=${plan.beats.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
