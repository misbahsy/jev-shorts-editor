// fixtures/samplePlan.ts — builds a ShortPlan fixture from a work dir's parakeet transcript for
// visual QA of the film page (core.js/themes.js/effects.js/captions.js/transitions.js/templates).
// The work dir must hold src.mp4 and tx/src.json (what auto.ts leaves behind after a run).
// Usage:
//   npx tsx src/short/film/fixtures/samplePlan.ts --work <dir> [--family <StyleFamilyId>] [--caption <CaptionStyleId>] [--out <path>]
import fs from "node:fs";
import path from "node:path";

const workIdx = process.argv.indexOf("--work");
const SCRATCH = path.resolve(workIdx > 0 && process.argv[workIdx + 1] ? process.argv[workIdx + 1] : "work");
const DEFAULT_OUT = path.join(SCRATCH, "fixtures", "sample-plan.json");
const SRC_MP4 = path.join(SCRATCH, "src.mp4");
const TX_JSON = path.join(SCRATCH, "tx", "src.json");
const DURATION = 50.6; // stated source duration (50.56s last token + small pad)

const FAMILIES = [
  "apple_glass", "bold_kinetic", "terminal_type", "neon_cyber",
  "paper_editorial", "clean_swiss", "gradient_pop", "dark_luxe",
];
const ACCENTS = ["blue", "green", "yellow", "orange", "red", "pink", "purple", "cyan"];
const CAPTION_STYLES = ["word_pop", "single_word", "karaoke_line", "boxed_highlight", "typewriter_line"];
const TEXT_EFFECTS = ["typewriter", "word_pop", "slide_up", "blur_in", "scramble_decode", "highlighter_swipe", "scale_punch", "mask_reveal"];
const TRANSITIONS = ["hard_cut", "flash", "whip_streak", "glass_wipe", "zoom_blur", "glitch_slice"];
// panel (split, non-underChin) templates — owned by another agent; expected to be silently
// skipped by Film.registerTemplate's unknown-id handling until those files land. Fine per spec.
const PANEL_TEMPLATES = ["versus", "option_chips", "quote", "definition", "numbered_point"];
// Truncates to a word boundary (never mid-word) within maxChars. A hard character slice
// (the previous approach) can land inside a word — e.g. "...good classifier" -> "...good cla" —
// which reads as broken/amateur on a bold display card; templates already shrink font-size to
// fit via Film.util.fitText, so this is just a last-resort safety net for very long sentences.
function truncateWords(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 6 ? cut.slice(0, lastSpace) : cut).trim();
}

const UNDER_CHIN_TEMPLATES: { id: string; fields: (text: string) => Record<string, unknown> }[] = [
  { id: "big_statement", fields: (t) => ({ text: t, sub: undefined }) },
  { id: "stamp", fields: (t) => ({ text: truncateWords(t, 26), tone: "negative" }) },
  { id: "keyword_pill", fields: (t) => ({ text: truncateWords(t, 22), emoji: "\u{1F4A1}" }) },
  { id: "stat_number", fields: () => ({ value: "85%", unit: undefined, label: "confidence" }) },
];

// Fixed geometry per task spec — computed elsewhere from the median face box in production;
// hardcoded here so the fixture is self-contained and doesn't depend on perceive.ts output.
const GEOMETRY = {
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
};

interface Token { text: string; start: number; end: number; duration: number; confidence: number }
interface Sentence { text: string; start: number; end: number; duration: number; confidence: number; tokens: Token[] }
interface Tx { text: string; sentences: Sentence[] }

interface Word { i: number; text: string; start: number; end: number; emph?: boolean }

function buildWords(tx: Tx): { words: Word[]; sentenceWordRanges: [number, number][] } {
  const words: Word[] = [];
  const sentenceWordRanges: [number, number][] = [];
  let wi = 0;
  for (const s of tx.sentences) {
    const startIdx = wi;
    let cur: Token[] = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur.map((t) => t.text).join("").trim();
      if (text.length) {
        words.push({
          i: wi,
          text,
          start: cur[0].start,
          end: cur[cur.length - 1].end,
          emph: wi % 9 === 3, // deterministic sprinkle of emphasized words for caption/effect QA
        });
        wi++;
      }
      cur = [];
    };
    for (const tok of s.tokens) {
      if (tok.text.startsWith(" ") && cur.length) flush();
      cur.push(tok);
    }
    flush();
    const endIdx = Math.max(startIdx, wi - 1);
    sentenceWordRanges.push([startIdx, endIdx]);
  }
  return { words, sentenceWordRanges };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const family = (args.family as string) || "bold_kinetic";
  const captionStyle = (args.caption as string) || "word_pop";
  const outPath = (args.out as string) || DEFAULT_OUT;
  if (!FAMILIES.includes(family)) throw new Error(`unknown --family ${family}`);
  if (!CAPTION_STYLES.includes(captionStyle)) throw new Error(`unknown --caption ${captionStyle}`);

  const tx: Tx = JSON.parse(fs.readFileSync(TX_JSON, "utf8"));
  const { words, sentenceWordRanges } = buildWords(tx);

  let fullBeatCount = 0;
  const beats = tx.sentences.map((s, idx) => {
    const layout: "full" | "split" = idx % 2 === 0 ? "full" : "split";
    const isLast = idx === tx.sentences.length - 1;
    const end = isLast ? DURATION : s.end;
    const transitionIn = TRANSITIONS[idx % TRANSITIONS.length];
    const textEffect = TEXT_EFFECTS[idx % TEXT_EFFECTS.length];

    let visual: Record<string, unknown> | null = null;
    if (layout === "full") {
      // idx is always even for full-layout beats, so cycling by idx directly would only ever
      // hit 2 of the 4 templates (mod 4). Use a dedicated counter so all 4 get exercised.
      const tpl = UNDER_CHIN_TEMPLATES[fullBeatCount % UNDER_CHIN_TEMPLATES.length];
      fullBeatCount++;
      visual = {
        template: tpl.id,
        fields: tpl.fields(s.text.replace(/\.$/, "").trim()),
        textEffect,
        confidence: 0.8,
      };
    } else if (idx % 3 !== 0) {
      // leave some split beats visual-less (speaker fills the panel via caption only)
      const tplId = PANEL_TEMPLATES[idx % PANEL_TEMPLATES.length];
      visual = {
        template: tplId,
        fields: { text: s.text, by: undefined, term: s.text.split(" ")[0], meaning: s.text },
        textEffect,
        confidence: 0.7,
      };
    }

    return {
      id: `beat_${idx}`,
      start: s.start,
      end,
      text: s.text,
      wordRange: sentenceWordRanges[idx],
      layout,
      visual,
      transitionIn: idx === 0 ? "hard_cut" : transitionIn,
      punchIn: idx % 5 === 4,
    };
  });

  const plan = {
    source: { path: SRC_MP4, durationSec: DURATION, width: 1080, height: 1080, fps: 30 },
    output: { width: 1080, height: 1920, fps: 30 },
    perception: {
      face: { x: 0.36, y: 0.24, w: 0.28, h: 0.33 },
      facePerSecond: [],
      description: "dark moody room, warm shelf lights, speaker centered with a podcast mic",
    },
    geometry: GEOMETRY,
    style: {
      family,
      accent: ACCENTS[FAMILIES.indexOf(family) % ACCENTS.length],
      captionStyle,
      energy: 1,
      progressBar: true,
    },
    words,
    beats,
    sfx: [],
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`wrote ${outPath} (${beats.length} beats, ${words.length} words, family=${family} caption=${captionStyle})`);
}

main();
