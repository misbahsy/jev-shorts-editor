// buildFilm.ts — inlines core.js + themes.js + effects.js + captions.js + transitions.js
// (exact load order matters: effects.js attaches Film.fx.text which captions.js relies on;
// themes.js must run before core.js's init() call which reads window.FilmThemes) + every
// film/templates/*.js + window.__PLAN into one self-contained transparent HTML file.
import fs from "node:fs";
import path from "node:path";

const FILM_DIR = __dirname;

// Load order: core (defines Film + placeholder fx.text) -> themes (CSS tokens) ->
// effects (fills in Film.fx.text) -> captions (uses Film.fx.text) -> transitions ->
// every registered template (needs Film.registerTemplate from core).
const CORE_FILES = ["core.js", "themes.js", "effects.js", "captions.js", "transitions.js"];

function readTemplateFiles(): { name: string; src: string }[] {
  const dir = path.join(FILM_DIR, "templates");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort() // deterministic order
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(dir, f), "utf8") }));
}

export function buildFilm(plan: unknown, outHtmlPath: string): void {
  const parts: string[] = [];
  parts.push("<!doctype html>");
  parts.push(
    '<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:1080px;height:1920px;overflow:hidden;}*{box-sizing:border-box;}</style></head><body>'
  );

  parts.push("<script>");
  for (const f of CORE_FILES) {
    const p = path.join(FILM_DIR, f);
    parts.push(`\n/* ---- ${f} ---- */\n`);
    parts.push(fs.readFileSync(p, "utf8"));
  }
  const templates = readTemplateFiles();
  for (const t of templates) {
    parts.push(`\n/* ---- templates/${t.name} ---- */\n`);
    parts.push(t.src);
  }
  parts.push("</script>");

  // window.__PLAN + boot call. JSON.stringify is safe to embed directly inside a <script> block
  // as long as we escape "</script" sequences that could appear inside string fields.
  const planJson = JSON.stringify(plan).replace(/<\/script/gi, "<\\/script");
  parts.push("<script>");
  parts.push(`window.__PLAN = ${planJson};`);
  parts.push("window.Film.init(window.__PLAN);");
  parts.push("</script>");

  parts.push("</body></html>");

  fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
  fs.writeFileSync(outHtmlPath, parts.join("\n"), "utf8");
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

// Allow `npx tsx film/buildFilm.ts --plan <plan.json> --out <film.html>` for standalone use.
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || !args.out) {
    console.error("Usage: buildFilm.ts --plan <plan.json> --out <film.html>");
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(String(args.plan), "utf8"));
  buildFilm(plan, String(args.out));
  console.log("wrote", args.out);
}
