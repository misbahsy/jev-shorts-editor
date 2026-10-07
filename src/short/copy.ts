/**
 * ONE batched Groq call that fills template fields for every beat that WILL
 * get a visual (per the FINAL structure from assembleStructure — layout and
 * template variety are already decided, so every schema here is the one
 * that's actually used), and proposes ASR proper-noun corrections. Falls
 * back to `claude -p --model haiku` if Groq fails outright.
 *
 * Validation/clamping and the schema-invalid fallback live here (exported)
 * but are APPLIED by finalize.ts, not by fillCopy itself — fillCopy's job is
 * just "ask the model, return what it said."
 */
import { execFileSync } from "node:child_process";
import { getGroqKey } from "./groqEnv";
import type { RawBeat, Word, TemplateId } from "./types";
import type { BeatStructure } from "./structure";

export interface Copy {
  beats: Record<string, Record<string, unknown>>; // RAW, unvalidated model output per beat
  corrections: { i: number; text: string }[];
  latencyMs: number;
}

// Benchmarked (see bench_models.ts / report): gpt-oss-20b is fastest (~1.5s avg) but missed the
// null->noul correction in both runs; gpt-oss-120b (~3.1s) and qwen3.8-27b (~2.1s) both catch all
// 3 corrections and pass schema validation every run. qwen3.8-27b wins on latency among the two
// that are actually accurate.
export const GROQ_TEXT_MODEL = "qwen/qwen3.8-27b";

interface FieldSpec {
  name: string;
  kind: "string" | "stringArray" | "number" | "enum" | "iconArray";
  required: boolean;
  maxWords?: number;
  minLen?: number;
  maxLen?: number;
  enumValues?: string[];
}
export const SCHEMA: Record<TemplateId, FieldSpec[]> = {
  big_statement: [{ name: "text", kind: "string", required: true, maxWords: 5 }, { name: "sub", kind: "string", required: false, maxWords: 5 }],
  stamp: [{ name: "text", kind: "string", required: true, maxWords: 3 }, { name: "tone", kind: "enum", required: true, enumValues: ["negative", "positive", "neutral"] }],
  keyword_pill: [{ name: "text", kind: "string", required: true, maxWords: 3 }, { name: "emoji", kind: "string", required: false, maxWords: 1 }],
  stat_number: [{ name: "value", kind: "string", required: true, maxWords: 3 }, { name: "unit", kind: "string", required: false, maxWords: 2 }, { name: "label", kind: "string", required: true, maxWords: 5 }],
  versus: [{ name: "left", kind: "string", required: true, maxWords: 5 }, { name: "right", kind: "string", required: true, maxWords: 5 }, { name: "leftSub", kind: "string", required: false, maxWords: 5 }, { name: "rightSub", kind: "string", required: false, maxWords: 5 }, { name: "winner", kind: "enum", required: false, enumValues: ["left", "right"] }],
  option_chips: [{ name: "question", kind: "string", required: false, maxWords: 5 }, { name: "options", kind: "stringArray", required: true, minLen: 2, maxLen: 5 }, { name: "pickedIndex", kind: "number", required: true }, { name: "confidencePct", kind: "number", required: false }],
  confidence_meter: [{ name: "label", kind: "string", required: true, maxWords: 5 }, { name: "pct", kind: "number", required: true }],
  yes_no: [{ name: "question", kind: "string", required: true, maxWords: 5 }, { name: "answer", kind: "enum", required: true, enumValues: ["yes", "no"] }, { name: "pct", kind: "number", required: true }],
  scale_slider: [{ name: "question", kind: "string", required: false, maxWords: 5 }, { name: "labels", kind: "stringArray", required: true, minLen: 2, maxLen: 5 }, { name: "value", kind: "number", required: true }, { name: "valueLabel", kind: "string", required: false, maxWords: 3 }],
  numbered_point: [{ name: "number", kind: "string", required: true, maxWords: 1 }, { name: "title", kind: "string", required: true, maxWords: 5 }, { name: "sub", kind: "string", required: false, maxWords: 5 }],
  checklist: [{ name: "title", kind: "string", required: false, maxWords: 5 }, { name: "items", kind: "stringArray", required: true, minLen: 2, maxLen: 4 }],
  chat_bubble: [{ name: "from", kind: "string", required: false, maxWords: 2 }, { name: "message", kind: "string", required: true, maxWords: 14 }],
  definition: [{ name: "term", kind: "string", required: true, maxWords: 3 }, { name: "meaning", kind: "string", required: true, maxWords: 10 }],
  icon_row: [{ name: "items", kind: "iconArray", required: true, minLen: 2, maxLen: 4 }],
  code_terminal: [{ name: "lines", kind: "stringArray", required: true, minLen: 1, maxLen: 4 }],
  flow_steps: [{ name: "steps", kind: "stringArray", required: true, minLen: 2, maxLen: 4 }],
  dual_stat: [{ name: "leftValue", kind: "string", required: true, maxWords: 3 }, { name: "leftLabel", kind: "string", required: true, maxWords: 5 }, { name: "rightValue", kind: "string", required: true, maxWords: 3 }, { name: "rightLabel", kind: "string", required: true, maxWords: 5 }],
  quote: [{ name: "text", kind: "string", required: true, maxWords: 14 }, { name: "by", kind: "string", required: false, maxWords: 3 }],
};

function schemaPrompt(t: TemplateId): string {
  return SCHEMA[t]
    .map(f => {
      const req = f.required ? "required" : "optional";
      if (f.kind === "stringArray") return `${f.name}: string[${f.minLen}..${f.maxLen}] (${req})`;
      if (f.kind === "iconArray") return `${f.name}: {emoji,label}[${f.minLen}..${f.maxLen}] (${req})`;
      if (f.kind === "enum") return `${f.name}: one of ${JSON.stringify(f.enumValues)} (${req})`;
      if (f.kind === "number") return `${f.name}: number (${req})`;
      return `${f.name}: string, <=${f.maxWords ?? 5} words (${req})`;
    })
    .join(", ");
}

export function buildPrompt(
  beats: RawBeat[],
  structure: BeatStructure[],
  words: Word[],
  meta: { title: string; sceneDescription?: string },
): string {
  const transcript = beats.map((b, i) => `${i + 1}. ${b.text}`).join("\n");
  const wordList = words.map(w => `${w.i}:${w.text}`).join(" ");

  const visualBeats = beats.map((b, i) => ({ b, i, st: structure[i] })).filter(({ st }) => st.hasVisual && st.template);

  const beatBlocks = visualBeats
    .map(({ b, i, st }) => {
      const prev = i > 0 ? beats[i - 1].text : "(none — this is the first beat)";
      const next = i < beats.length - 1 ? beats[i + 1].text : "(none — this is the last beat)";
      return `- id="${b.id}" template="${st.template}" fields{${schemaPrompt(st.template as TemplateId)}}\n  prev: "${prev}"\n  text: "${b.text}"\n  next: "${next}"`;
    })
    .join("\n");

  const sceneLine = meta.sceneDescription ? `WHAT IS ON SCREEN: ${meta.sceneDescription}\n` : "";

  return `You are writing on-screen text for a vertical short-form video edit. Source: "${meta.title}".
${sceneLine}The ASR transcript may contain proper-noun or technical-term errors (this video's subject matter is
unknown to you in advance — do not assume any particular product or domain). Find likely errors using the
transcript's OWN internal evidence: a term that recurs several times with inconsistent spellings across its
occurrences, or a common word that is nonsensical in its sentence and is a near-homophone of a domain term implied
by the surrounding speech, the video title, and (if given) what's on screen. Fix only errors you have real
evidence for via word-index corrections — if nothing looks wrong, return an empty corrections array; never
invent a correction just to have one.

FULL TRANSCRIPT (by beat):
${transcript}

WORDS (global index:text, for corrections):
${wordList}

For EACH beat below, fill its template's fields using the speaker's own wording, numbers and examples. Adjacent
beats often continue ONE idea across a sentence break — read prev/next too: a number or answer spoken in the
NEXT beat can belong on THIS card if this card's template needs it (e.g. a yes/no question beat is followed by
"0.95 ... leaning towards yes" -> that yes_no card's pct is 95; the beat that speaks "0.95" itself should get a
card about what the number means, e.g. confidence_meter "Leaning yes" 95 — don't just restate "0.95" as text).
Template-specific rules:
- stamp.tone: ONLY judge the text when the speaker is actually making a value claim — "negative" for a
  limitation/can't/never/impossible, "positive" for a guarantee/benefit/capability. Use "neutral" (the common
  case) for a plain name or label that asserts nothing: a product, tool, brand, feature or place name
  ("Apple Maps Kit", "Postgres", "Berlin"). Neutral stamps take the video's accent colour; positive/negative
  spend the reserved green/red, so a stamp that isn't a verdict must be neutral or it reads as an off-palette
  judgement the speaker never made.
- versus.left/right must be short meaningful LABELS for what's being contrasted (e.g. "writes text" / "makes
  decisions"), never a leftover transcript fragment like "different than" or "instead of".
- numbered_point.number must be the ordinal the speaker actually SAYS in this beat ("one"->"1", "two"->"2",
  "3"->"3"). Never invent an ordinal that isn't spoken.
- dual_stat / stat_number values are BIG DISPLAY text: a number or at most ~8 characters ("<1s", "10x", "$0.04",
  "85%"); put the explanation in the label, never a phrase in the value. If the speaker gives NO number, use one
  short word from the speech ("Instant", "Cheap") — NEVER make up a figure the speaker didn't say.
- scale_slider.valueLabel: the spoken score only (e.g. "1.6"), or omit it. versus subs: <=3 words each.
- a beat whose text spans several sentences is ONE card held on screen: fill it from the whole text.
Other rules: punchy, <=5 words per string field unless the field says otherwise; use real numbers/examples
verbatim; no emojis except in an "emoji" field; never invent facts not present in prev/text/next.

BEATS NEEDING FIELDS:
${beatBlocks}

Respond with JSON only, matching this shape exactly:
{"beats": {"<beatId>": {<fields for that beat's template>}}, "corrections": [{"i": <word index>, "text": "<corrected text>"}]}`;
}

function clampWords(s: string, maxWords: number): string {
  const parts = s.trim().split(/\s+/);
  return parts.length <= maxWords ? s.trim() : parts.slice(0, maxWords).join(" ");
}

export function validateAndClamp(template: TemplateId, raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const spec of SCHEMA[template]) {
    const v = input[spec.name];
    if (v === undefined || v === null) {
      if (spec.required) return null;
      continue;
    }
    if (spec.kind === "string") {
      if (typeof v !== "string") return null;
      out[spec.name] = clampWords(v, spec.maxWords ?? 5);
    } else if (spec.kind === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n)) return null;
      out[spec.name] = n;
    } else if (spec.kind === "enum") {
      if (typeof v !== "string" || !spec.enumValues?.includes(v)) return null;
      out[spec.name] = v;
    } else if (spec.kind === "stringArray") {
      if (!Array.isArray(v)) return null;
      let arr = v.filter(x => typeof x === "string") as string[];
      if (arr.length < (spec.minLen ?? 0)) return null;
      if (spec.maxLen) arr = arr.slice(0, spec.maxLen);
      out[spec.name] = arr.map(s => clampWords(s, 6));
    } else if (spec.kind === "iconArray") {
      if (!Array.isArray(v)) return null;
      let arr = v.filter(x => x && typeof x === "object" && "emoji" in (x as any) && "label" in (x as any)) as { emoji: string; label: string }[];
      if (arr.length < (spec.minLen ?? 0)) return null;
      if (spec.maxLen) arr = arr.slice(0, spec.maxLen);
      out[spec.name] = arr.map(o => ({ emoji: String(o.emoji), label: clampWords(String(o.label), 4) }));
    }
  }
  return out;
}

/** Schema-invalid-copy fallback: a 2-4 word phrase from the beat itself (emphasis word plus its
 * neighbours, punctuation stripped) — never a lone token like "0.95," or "pick". */
export function fallbackPhrase(beat: RawBeat, emphasisChoice: string | null | undefined, words: Word[]): string {
  const strip = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  let center = -1;
  if (emphasisChoice && /^w\d+$/.test(emphasisChoice)) center = Number(emphasisChoice.slice(1));
  if (center < 0 || !words[center]) {
    // no emphasis word available: first 3 content words of the beat
    const lo = beat.wordRange[0];
    const hi = Math.min(beat.wordRange[1], lo + 2);
    return words
      .slice(lo, hi + 1)
      .map(w => strip(w.text))
      .filter(Boolean)
      .join(" ");
  }
  const lo = Math.max(beat.wordRange[0], center - 1);
  const hi = Math.min(beat.wordRange[1], center + 1);
  const phrase = words
    .slice(lo, hi + 1)
    .map(w => strip(w.text))
    .filter(Boolean)
    .join(" ");
  return phrase || strip(words[center].text);
}

export function fallbackBigStatement(beat: RawBeat, emphasisChoice: string | null | undefined, words: Word[]): Record<string, unknown> {
  return { text: fallbackPhrase(beat, emphasisChoice, words) };
}

async function callGroq(prompt: string, apiKey: string, model: string, maxTokens: number, reasoningEffort?: string): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: maxTokens,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Groq copy call failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq copy call returned no content");
  return text;
}

function callClaudeFallback(prompt: string): string {
  const out = execFileSync("claude", ["-p", "--model", "haiku", prompt], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return out;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  return JSON.parse(body);
}

export async function fillCopy(
  beats: RawBeat[],
  structure: BeatStructure[],
  words: Word[],
  meta: { title: string; sceneDescription?: string },
): Promise<Copy> {
  const prompt = buildPrompt(beats, structure, words, meta);
  const start = Date.now();

  let raw: unknown;
  try {
    const apiKey = getGroqKey();
    const reasoningEffort = GROQ_TEXT_MODEL.startsWith("openai/gpt-oss") ? "low" : undefined;
    // 4096, not 1024: this is ONE batched call covering every visual beat's fields plus
    // corrections. With 11+ visual beats the response silently truncates at 1024, which then
    // fails JSON parsing and falls through to the `claude -p --model haiku` subprocess fallback
    // — expensive and easy to miss. 4096 gives real headroom without meaningfully changing latency.
    const text = await callGroq(prompt, apiKey, GROQ_TEXT_MODEL, 4096, reasoningEffort);
    raw = extractJson(text);
  } catch {
    const text = callClaudeFallback(prompt);
    raw = extractJson(text);
  }
  const latencyMs = Date.now() - start;

  const parsed = raw as { beats?: Record<string, Record<string, unknown>>; corrections?: { i: number; text: string }[] };
  const outBeats: Record<string, Record<string, unknown>> = {};
  beats.forEach((b, idx) => {
    if (structure[idx].hasVisual && structure[idx].template) outBeats[b.id] = parsed.beats?.[b.id] ?? {};
  });

  const corrections = Array.isArray(parsed.corrections)
    ? parsed.corrections.filter(c => typeof c?.i === "number" && typeof c?.text === "string")
    : [];

  return { beats: outBeats, corrections, latencyMs };
}
