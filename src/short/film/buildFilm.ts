// buildFilm.ts — inlines core.js + themes.js + effects.js + captions.js + transitions.js
// (exact load order matters: effects.js attaches Film.fx.text which captions.js relies on;
// themes.js must run before core.js's init() call which reads window.FilmThemes) + every
// film/templates/*.js + window.__PLAN into one self-contained transparent HTML file.
import fs from "node:fs";
import path from "node:path";
import { captionWords, leakPreset, resolveCaptionPreset } from "../hook";

const FILM_DIR = __dirname;
const ENGINE_FILE = path.join(FILM_DIR, "vendor", "engine.js");
const FONT_DIR = path.join(FILM_DIR, "vendor", "fonts");

// Load order: core (defines Film + placeholder fx.text) -> themes (CSS tokens) ->
// effects (fills in Film.fx.text) -> captions (uses Film.fx.text) -> transitions ->
// every registered template (needs Film.registerTemplate from core).
const CORE_FILES = ["core.js", "themes.js", "effects.js", "captions.js", "transitions.js", "hook24.js"];

function readTemplateFiles(): { name: string; src: string }[] {
  const dir = path.join(FILM_DIR, "templates");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort() // deterministic order
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(dir, f), "utf8") }));
}

/**
 * The vendored 24fps engine as a classic script: `export`s stripped, wrapped in an IIFE that sets
 * window.Film24, and loadFonts patched to wait on the embedded @font-face rules instead of loading
 * a Google Fonts stylesheet (nothing may touch the network at render time).
 */
export function inlineEngine(src = fs.readFileSync(ENGINE_FILE, "utf8")): string {
  const body = src.replace(/^export\s+/gm, "");
  if (/^\s*import\s/m.test(body)) throw new Error("24fps engine unexpectedly imports a module");
  const head = 'function loadFonts(families) {\n  if (typeof document === "undefined") return;';
  if (!body.includes(head)) throw new Error("24fps engine: loadFonts changed, update the patch in buildFilm.ts");
  const patched = body.replace(
    head,
    head +
      '\n  fontsPending = Promise.all([fontsPending, ...families.filter((f) => f && f.family).map((f) => document.fonts.load(`${f.italic ? "italic " : ""}${f.weight || 400} 1em "${f.family}"`).catch(() => null))]);' +
      "\n  return fontsPending;"
  );
  return `window.Film24 = (function () {\n${patched}\nreturn { mount, timeWords, loadFonts, VERSION };\n})();`;
}

interface FontRef {
  family?: string;
  weight?: number;
  italic?: boolean;
}

function collectFonts(node: unknown, out: Map<string, FontRef>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectFonts(n, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === "font" || k === "emphasisFont") && v && typeof v === "object" && typeof (v as FontRef).family === "string") {
        const f = v as FontRef;
        out.set(fontKey(f), f);
      }
      collectFonts(v, out);
    }
  }
}

export const fontKey = (f: FontRef): string => `${f.family}|${f.weight || 400}|${f.italic ? 1 : 0}`;

/** @font-face rules (data URIs) for exactly the families the given presets use. */
export function fontFaceCss(presets: unknown[], fontDir = FONT_DIR): string {
  const need = new Map<string, FontRef>();
  collectFonts(presets, need);
  const index = JSON.parse(fs.readFileSync(path.join(fontDir, "fonts.json"), "utf8")) as Record<string, string>;
  const css: string[] = [];
  for (const [key, f] of need) {
    const file = index[key];
    if (!file) throw new Error(`24fps font not vendored: ${key}`);
    const b64 = fs.readFileSync(path.join(fontDir, file)).toString("base64");
    css.push(
      `@font-face{font-family:"${f.family}";font-weight:${f.weight || 400};font-style:${f.italic ? "italic" : "normal"};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`
    );
  }
  return css.join("\n");
}

/** The caption sections of a plan: the planned list, or one section spanning the clip. */
export function planCaptionSections(plan: any): { start: number; end: number; style: string }[] {
  const secs = plan?.captionSections;
  if (Array.isArray(secs) && secs.length) return secs;
  const style = plan?.style?.captionStyle;
  return style ? [{ start: 0, end: plan?.source?.durationSec ?? 1e9, style }] : [];
}

export type CaptionTrack = {
  style: string;
  preset: Record<string, any>;
  /** only the words spoken inside this style's sections, so the engine pages never straddle a switch */
  words: unknown[];
  ranges: [number, number][];
};

/** One engine caption track per engine style that the plan actually uses. */
export function captionTracks(plan: any): CaptionTrack[] {
  const byStyle = new Map<string, [number, number][]>();
  for (const s of planCaptionSections(plan)) {
    if (!resolveCaptionPreset(s.style as any)) continue;
    const list = byStyle.get(s.style) ?? [];
    list.push([s.start, s.end]);
    byStyle.set(s.style, list);
  }
  const words: any[] = plan?.words ?? [];
  const out: CaptionTrack[] = [];
  for (const [style, ranges] of byStyle) {
    const mine = words.filter(w => ranges.some(([a, b]) => w.start >= a - 1e-6 && w.start < b - 1e-6));
    out.push({ style, preset: resolveCaptionPreset(style as any)!, words: captionWords(mine), ranges });
  }
  return out;
}

/** What window.__FILM24 carries: one engine track per engine caption style used, plus the leak preset. */
export function film24Config(plan: any): { captions: CaptionTrack[]; leak: Record<string, any> | null } {
  const leaks: number[] = plan?.fx?.leaks ?? [];
  return {
    captions: captionTracks(plan),
    leak: leaks.length ? leakPreset() : null,
  };
}

export function buildFilm(plan: unknown, outHtmlPath: string): void {
  const parts: string[] = [];
  parts.push("<!doctype html>");
  parts.push(
    '<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;width:1080px;height:1920px;overflow:hidden;}*{box-sizing:border-box;}</style></head><body>'
  );

  // the 24fps engine (hook, engine captions, light leaks) with the fonts it needs embedded
  const cfg24 = film24Config(plan);
  const hookPreset = (plan as any)?.hook?.preset;
  const giantPresets = ((plan as any)?.giants ?? []).map((g: any) => g.preset);
  const css = fontFaceCss([hookPreset, ...giantPresets, ...cfg24.captions.map(c => c.preset), cfg24.leak].filter(Boolean));
  if (css) parts.push(`<style>${css}</style>`);
  parts.push("<script>");
  parts.push(inlineEngine());
  parts.push(`window.__FILM24 = ${JSON.stringify(cfg24).replace(/<\/script/gi, "<\\/script")};`);
  parts.push("</script>");

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
