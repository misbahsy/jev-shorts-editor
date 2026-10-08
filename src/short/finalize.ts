/**
 * Stage: finalize — validates/clamps the LLM's copy against each beat's FINAL
 * template schema (falling back to a short phrase from the beat itself only
 * when the copy is schema-invalid), applies word corrections, materializes
 * Beat.text from the CORRECTED words, rounds beat start/end to the nearest
 * 1/30s frame (keeping contiguity), marks emphasis words, and places sfx.
 * No LLM/Jev calls here — structure (layout/template/effects/transition/
 * punchIn) was already finalized by assembleStructure before copy was ever
 * generated, so this stage only ever validates, never re-decides structure.
 */
import type { Word, RawBeat, Perception, Geometry, Decisions, BeatDecision, Copy, Beat, ShortPlan, FaceBox } from "./types";
import type { BeatStructure } from "./structure";
import { validateAndClamp, fallbackBigStatement } from "./copy";

const SFX_MIN_GAP_SEC = 2.5;
const SFX_MIN_CONF = 0.45;
const FPS = 30;

export interface FinalizeInput {
  words: Word[];
  beats: RawBeat[];
  structure: BeatStructure[];
  perception: Perception;
  geometry: Geometry;
  decisions: Decisions;
  copy: Copy;
  source: { path: string; durationSec: number; width: number; height: number; fps: number };
  /** Per-shot sound picks (start time + the shot's own decision). Absent = one pick per beat. */
  sfxShots?: { start: number; dec: BeatDecision }[];
}

function snapToFrame(t: number): number {
  return Math.round(t * FPS) / FPS;
}

export function finalize(input: FinalizeInput): ShortPlan {
  const { words: rawWords, beats: rawBeats, structure, perception, geometry, decisions, copy, source } = input;

  // 1. apply corrections to words
  const words: Word[] = rawWords.map(w => ({ ...w }));
  for (const c of copy.corrections) {
    if (words[c.i]) words[c.i] = { ...words[c.i], text: c.text };
  }

  // 2. mark emphasis words
  for (const dec of decisions.beats) {
    const held = (dec as BeatDecision & { heldEmphasis?: string[] }).heldEmphasis ?? [];
    for (const em of [dec.emphasis?.choice, ...held]) {
      if (em && /^w\d+$/.test(em)) {
        const wi = Number(em.slice(1));
        if (words[wi]) words[wi] = { ...words[wi], emph: true };
      }
    }
  }

  // 3. validate/clamp copy per beat's FINAL template; fall back to a short phrase on schema-invalid copy
  const fields: (Record<string, unknown> | null)[] = rawBeats.map((raw, i) => {
    const st = structure[i];
    if (!st.hasVisual || !st.template) return null;
    const dec: BeatDecision = decisions.beats[i];
    const raw_copy = copy.beats[raw.id];
    const validated = validateAndClamp(st.template, raw_copy);
    if (validated) return validated;
    // schema-invalid: only big_statement's schema is a single short "text" field, so the fallback
    // phrase is a safe substitute regardless of the beat's actual (possibly non-big_statement) template.
    return fallbackBigStatement(raw, dec.emphasis?.choice, words);
  });

  // 3b. speech-synced reveal: the card's "answer" lands as the speaker says it (seconds since beat start).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%]/g, "");
  rawBeats.forEach((raw, i) => {
    const f = fields[i];
    const tpl = structure[i].template;
    if (!f || !tpl || !["yes_no", "scale_slider", "confidence_meter", "option_chips"].includes(tpl)) return;
    const beatWords = words.slice(raw.wordRange[0], raw.wordRange[1] + 1).filter(w => w.start - raw.start > 0.6);
    const picked = tpl === "option_chips" ? (f.options as string[] | undefined)?.[Number(f.pickedIndex)] : tpl === "confidence_meter" ? (f.label as string) : undefined;
    const hit =
      (picked && tpl === "option_chips" ? beatWords.find(w => norm(w.text) === norm(picked)) : undefined) ??
      beatWords.find(w => /\d/.test(w.text)) ??
      (picked ? beatWords.find(w => norm(w.text) === norm(picked)) : undefined);
    if (hit) f.revealAt = Math.round((hit.start - raw.start - 0.15) * 100) / 100;
  });

  // 4. materialize corrected beat text (from corrected words, not raw ASR text) + snap start/end to frames
  const correctedText = (wordRange: [number, number]): string =>
    words
      .slice(wordRange[0], wordRange[1] + 1)
      .map(w => w.text)
      .join(" ");

  const snappedStarts = rawBeats.map(b => snapToFrame(b.start));
  const beats: Beat[] = rawBeats.map((raw, i) => {
    const st = structure[i];
    const start = snappedStarts[i];
    const end = i + 1 < rawBeats.length ? snappedStarts[i + 1] : snapToFrame(raw.end);
    return {
      id: raw.id,
      start,
      end,
      text: correctedText(raw.wordRange),
      wordRange: raw.wordRange,
      layout: st.layout,
      visual: st.template
        ? { template: st.template, fields: fields[i] ?? {}, textEffect: st.textEffect, confidence: decisions.beats[i].template.confidence }
        : null,
      transitionIn: st.transitionIn,
      punchIn: st.punchIn,
    };
  });

  // 5. sfx placement: confidence>=0.45, not "none", spaced >=2.5s apart. Candidates are the shot
  //    starts when the shots are known (they carry the per-shot pick), else the beat starts.
  const SFX_TYPES = new Set(["whoosh", "pop", "ding", "riser", "impact"]);
  const sfx: ShortPlan["sfx"] = [];
  let lastSfxAt = -Infinity;
  const candidates = input.sfxShots ?? rawBeats.map((_, i) => ({ start: beats[i].start, dec: decisions.beats[i] }));
  for (const c of candidates) {
    const choice = c.dec.sfx.choice;
    if (choice === "none" || !SFX_TYPES.has(choice)) continue;
    if (c.dec.sfx.confidence < SFX_MIN_CONF) continue;
    const at = snapToFrame(c.start);
    if (at - lastSfxAt < SFX_MIN_GAP_SEC) continue;
    sfx.push({ type: choice as "whoosh" | "pop" | "ding" | "riser" | "impact", at, gainDb: -16 });
    lastSfxAt = at;
  }

  const g = decisions.global;
  const plan: ShortPlan = {
    source,
    output: { width: 1080, height: 1920, fps: 30 },
    perception: {
      face: perception.face as FaceBox,
      facePerSecond: perception.facePerSecond,
      description: perception.description,
      faceConfidence: perception.faceConfidence,
      hasReliableFace: perception.hasReliableFace,
    },
    geometry,
    style: {
      family: g.family.choice,
      accent: g.accent.choice,
      captionStyle: g.captionStyle.choice,
      energy: g.energy.score,
      progressBar: g.progressBar.noul >= 0.5,
    },
    words,
    beats,
    sfx,
  };
  return plan;
}
