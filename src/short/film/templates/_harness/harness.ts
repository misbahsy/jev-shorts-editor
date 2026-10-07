// THROWAWAY dev harness — NOT shipped, NOT part of the real film/ build.
// Renders ONE template in isolation (single synthetic beat) at requested
// timestamps, for visual verification while the real film/core.js is being
// written by another agent in parallel.
//
// Usage:
//   npx tsx src/short/film/templates/_harness/harness.ts \
//     --template option_chips --theme apple_glass --t 0.3,1.2,2.5 --dur 3.5 --out <dir>
//
// Writes 1080x1920 PNGs (panel painted 0..840, template root at x60,y150,960x640,
// dark-grey placeholder speaker block 840..1920) to --out, one file per --t.

import fs from "node:fs";
import path from "node:path";
import { startSidecar } from "../../../../render/sidecar";
import { seekExpr, READY_EXPR, DOUBLE_RAF_EXPR } from "../../../../render/seekScript";

const TEMPLATES_DIR = path.resolve(__dirname, "..");
const HARNESS_DIR = __dirname;

type Fields = Record<string, unknown>;

// Sample fields drawn from the target video's content (Jev classifier explainer).
const SAMPLE_FIELDS: Record<string, Fields> = {
  option_chips: {
    question: "What's this about?",
    options: ["Billing", "Technical", "Sales"],
    pickedIndex: 1,
    confidencePct: 85,
  },
  confidence_meter: { label: "Technical", pct: 85 },
  yes_no: { question: "Asking for a refund?", answer: "yes", pct: 95 },
  scale_slider: {
    question: "How urgent?",
    labels: ["Calm", "Frustrated", "Furious"],
    value: 1.6,
    valueLabel: "Frustrated",
  },
  versus: {
    left: "ChatGPT",
    right: "Jev",
    leftSub: "built for chatting",
    rightSub: "built for deciding",
    winner: "right",
  },
  numbered_point: { number: 1, title: "Pick from a list", sub: "Not free-form generation" },
  dual_stat: { leftValue: "<1s", leftLabel: "response", rightValue: "~$0.04", rightLabel: "per 1M tokens" },
  chat_bubble: { from: "User", message: "I want my money back, please" },
  checklist: { title: "Why Jev", items: ["Fast", "Cheap", "Deterministic"] },
  definition: { term: "Classifier", meaning: "Picks one of your options, fast" },
  flow_steps: { steps: ["Define options", "Send transcript", "Get decision", "Ship it"] },
  icon_row: {
    items: [
      { emoji: "⚡", label: "Fast" },
      { emoji: "💰", label: "Cheap" },
      { emoji: "🎯", label: "Accurate" },
    ],
  },
  code_terminal: { lines: ["$ jev classify --options refund,billing", "> picked: refund (95%)"] },
  quote: { text: "Built for deciding, not chatting", by: "Jev product notes" },
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function buildPage(templateId: string, theme: string, accentId: string, dur: number, fields: Fields): string {
  const tplPath = path.join(TEMPLATES_DIR, `${templateId}.js`);
  if (!fs.existsSync(tplPath)) throw new Error(`template file not found: ${tplPath}`);
  const tplSrc = fs.readFileSync(tplPath, "utf8");
  const stubSrc = fs.readFileSync(path.join(HARNESS_DIR, "stubCore.js"), "utf8");
  const harnessInit = {
    templateId,
    fields,
    theme,
    accentId,
    dur,
    energy: 1,
    textEffect: "slide_up",
  };
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; width:1080px; height:1920px; background:#000; overflow:hidden; }
  #stage { position:relative; width:1080px; height:1920px; }
  #panel { position:absolute; left:0; top:0; width:1080px; height:840px; background:var(--panel-bg, #171233); }
  #speaker { position:absolute; left:0; top:840px; width:1080px; height:1080px; background:#3a3a3a; }
  #speaker::after { content:'speaker (placeholder)'; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#888; font:24px sans-serif; }
  #film { position:absolute; left:0; top:0; width:1080px; height:1920px; }
  #film-root { position:absolute; left:60px; top:150px; width:960px; height:640px; }
  .fcard { background:var(--card-bg); border:var(--card-border); border-radius:var(--card-radius); box-shadow:var(--card-shadow); backdrop-filter:blur(var(--card-blur)); -webkit-backdrop-filter:blur(var(--card-blur)); }
</style>
</head>
<body>
  <div id="stage">
    <div id="panel"></div>
    <div id="speaker"></div>
    <div id="film"><div id="film-root"></div></div>
  </div>
  <script>${stubSrc}</script>
  <script>${tplSrc}</script>
  <script>
    window.__HARNESS = ${JSON.stringify(harnessInit)};
    window.__mount();
  </script>
</body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const templateId = args.template;
  const theme = args.theme || "apple_glass";
  const accentId = args.accent || "blue";
  const dur = Number(args.dur || "3.5");
  const times = String(args.t || "0.3,1.5,3.0")
    .split(",")
    .map((s) => Number(s.trim()));
  const outDir = args.out || process.cwd();
  if (!templateId) {
    console.error(
      "Usage: harness.ts --template <id> --theme apple_glass|bold_kinetic --t 0.3,1.2,2.5 --dur 3.5 --out <dir>"
    );
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const fields = SAMPLE_FIELDS[templateId];
  if (!fields) throw new Error(`no sample fields for template: ${templateId}`);

  const html = buildPage(templateId, theme, accentId, dur, fields);
  const htmlPath = path.join(outDir, `${templateId}_${theme}.html`);
  fs.writeFileSync(htmlPath, html, "utf8");

  const handle = startSidecar();
  const windowId = 1;
  try {
    await handle.request("create", windowId, { width: 1080, height: 1920, show: false, transparent: false, title: "tpl-harness" });
    await handle.request("setBackgroundColor", windowId, { color: "#000000" });
    await handle.request("loadFile", windowId, { path: path.resolve(htmlPath) });
    await handle.request("evaluate", windowId, { source: READY_EXPR });
    await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });

    for (const t of times) {
      await handle.request("evaluate", windowId, { source: seekExpr(t) });
      await handle.request("evaluate", windowId, { source: DOUBLE_RAF_EXPR });
      const cap = await handle.request("capture", windowId, {});
      const png = Buffer.from(cap.png as string, "base64");
      const outPath = path.join(outDir, `${templateId}_${theme}_t${t.toFixed(2)}.png`);
      fs.writeFileSync(outPath, png);
      console.log(`wrote ${outPath}`);
    }
    await handle.request("destroy", windowId, {});
  } finally {
    handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
