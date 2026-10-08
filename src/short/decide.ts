/**
 * Beat construction (from words, since that's all this function receives —
 * sentence boundaries are re-derived from trailing sentence punctuation) +
 * the Jev fan-out: one global request, one request per SHOT (a 2 to 3 second run of words from
 * shots.ts), and one caption-style request per section of the video.
 *
 * Every per-shot request is independent and all of them go out at once, so the wall time of the
 * whole stage is one request's latency (about 0.2 s) however many shots there are.
 */
import { getJevTarget } from "../env";
import { callSystemOne, type Question, type Answer, type ChoiceAnswer, type ScoreAnswer, type NoulAnswer } from "../jevClient";
import {
  STYLE_FAMILY_MENU,
  ACCENT_MENU,
  CAPTION_STYLE_MENU,
  HOOK_MENU,
  ENERGY_SCORE_CRITERIA,
  TEXT_EFFECT_MENU,
  TRANSITION_MENU,
  SFX_MENU,
  CAMERA_MENU,
  OVERLAY_MENU,
  templateChoiceCriteria,
} from "./menus";
import { splitShots } from "./shots";
import type { Word, Perception, GlobalDecisions, BeatDecision, Decisions, JevStats, RawBeat, SectionDecision, TemplateId } from "./types";

/** Roughly how long one caption-style section runs. Boundaries land on a shot that ends a sentence. */
export const SECTION_TARGET_SEC = 13;
export const SECTION_MAX_SEC = 19;

const MIN_BEAT_SEC = 1.2;
const MAX_BEAT_SEC = 5.0;
const CLAUSE_WORDS = new Set(["whereas", "and", "so"]);
const STOPWORDS = new Set([
  "a", "an", "the", "is", "it", "of", "to", "in", "on", "at", "or", "and", "so", "but", "for",
  "with", "as", "be", "was", "were", "are", "this", "that", "these", "those", "i", "you", "we",
  "they", "he", "she", "if", "then", "than", "just", "can", "could", "will", "would", "should",
  "do", "does", "did", "not", "no", "yes", "up", "out", "one", "two", "three", "big", "way",
]);

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]?$/.test(text);
}

/** Deterministic, pure function of `words` — plan.ts calls this to get the
 * beat list, and decide() below calls it identically so its BeatDecision.beatId
 * values line up with those beats. */
export function buildBeats(words: Word[]): RawBeat[] {
  if (words.length === 0) {
    // DEFECT 6 fix: no words means no detected speech in the source audio. Silently returning
    // [] used to flow all the way through to a blank/silent short with no explanation. Fail
    // loudly and specifically instead of inventing captions or filler content — a caller that
    // wants a softer UX can catch this and surface the message, but it must not be swallowed.
    throw new Error(
      "buildBeats: no words to build beats from — no speech was detected in this video's audio. " +
        "This pipeline turns spoken narration into a short; a source with no transcribed words " +
        "cannot honestly produce one. Provide a video with dialogue/narration, or check that " +
        "transcription actually ran against the correct audio track.",
    );
  }

  // 1) split into raw sentences on trailing sentence punctuation
  type Group = { start: number; end: number }; // word index range [start,end)
  const groups: Group[] = [];
  let groupStart = 0;
  for (let i = 0; i < words.length; i++) {
    if (endsSentence(words[i].text) || i === words.length - 1) {
      groups.push({ start: groupStart, end: i + 1 });
      groupStart = i + 1;
    }
  }

  // 2) merge groups shorter than MIN_BEAT_SEC into a neighbour (next if present, else previous)
  let merged = groups.slice();
  let guard = 0;
  while (guard++ < merged.length + 5) {
    const shortIdx = merged.findIndex(g => words[g.end - 1].end - words[g.start].start < MIN_BEAT_SEC);
    if (shortIdx === -1) break;
    if (merged.length === 1) break; // nothing to merge with
    if (shortIdx < merged.length - 1) {
      merged[shortIdx] = { start: merged[shortIdx].start, end: merged[shortIdx + 1].end };
      merged.splice(shortIdx + 1, 1);
    } else {
      merged[shortIdx - 1] = { start: merged[shortIdx - 1].start, end: merged[shortIdx].end };
      merged.splice(shortIdx, 1);
    }
  }

  // 3) split groups longer than MAX_BEAT_SEC at the clause boundary nearest the middle word
  const final: Group[] = [];
  for (const g of merged) {
    let cur = g;
    // a beat could need >1 split; loop until short enough or no candidate
    while (words[cur.end - 1].end - words[cur.start].start > MAX_BEAT_SEC) {
      const midIdx = cur.start + Math.floor((cur.end - cur.start) / 2);
      let bestI = -1;
      let bestDist = Infinity;
      for (let i = cur.start; i < cur.end - 1; i++) {
        const w = words[i].text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
        const hasComma = /,$/.test(words[i].text);
        if (hasComma || CLAUSE_WORDS.has(w)) {
          const dist = Math.abs(i - midIdx);
          if (dist < bestDist) {
            bestDist = dist;
            bestI = i;
          }
        }
      }
      if (bestI === -1 || bestI + 1 >= cur.end || bestI + 1 <= cur.start) {
        // no clause boundary found (or it's degenerate) — stop trying to split further
        break;
      }
      final.push({ start: cur.start, end: bestI + 1 });
      cur = { start: bestI + 1, end: cur.end };
    }
    final.push(cur);
  }

  // 4) materialize beats, then make them contiguous by extending each end to the next start
  const beats: RawBeat[] = final.map((g, idx) => ({
    id: `b${idx}`,
    start: words[g.start].start,
    end: words[g.end - 1].end,
    text: words
      .slice(g.start, g.end)
      .map(w => w.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    wordRange: [g.start, g.end - 1],
  }));
  for (let i = 0; i < beats.length - 1; i++) beats[i].end = beats[i + 1].start;
  if (beats.length > 0) beats[0].start = 0;

  return beats;
}

/**
 * Groups shots into sections of about SECTION_TARGET_SEC, ending each on a shot whose last word
 * ends a sentence (or at SECTION_MAX_SEC regardless). A tail shorter than half a target is folded
 * into the section before it. Pure.
 */
export function buildSections(shots: RawBeat[], words: Word[]): { first: number; last: number; start: number; end: number }[] {
  const out: { first: number; last: number; start: number; end: number }[] = [];
  let first = 0;
  for (let i = 0; i < shots.length; i++) {
    const dur = shots[i].end - shots[first].start;
    const sentenceEnd = endsSentence(words[shots[i].wordRange[1]].text);
    if (i === shots.length - 1 || (dur >= SECTION_TARGET_SEC && sentenceEnd) || dur >= SECTION_MAX_SEC) {
      out.push({ first, last: i, start: shots[first].start, end: shots[i].end });
      first = i + 1;
    }
  }
  if (out.length > 1) {
    const tail = out[out.length - 1];
    if (tail.end - tail.start < SECTION_TARGET_SEC / 2) {
      const prev = out[out.length - 2];
      out.splice(out.length - 2, 2, { first: prev.first, last: tail.last, start: prev.start, end: tail.end });
    }
  }
  return out;
}

function footageContext(perception: Perception): string {
  return `${perception.description}\nOUTPUT: vertical 9:16 short for TikTok/Reels; two layouts: speaker full-screen, or split with graphics panel on top and speaker below.`;
}

function numberedTranscript(beats: RawBeat[]): string {
  return beats.map((b, i) => `${i + 1}. ${b.text}`).join("\n");
}

function contentWordCandidates(beat: RawBeat, words: Word[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (let i = beat.wordRange[0]; i <= beat.wordRange[1]; i++) {
    const w = words[i];
    const norm = w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (!norm || STOPWORDS.has(norm) || norm.length < 3) continue;
    out.push({ id: `w${i}`, text: w.text });
  }
  return out;
}

// ---- tiny concurrency-limited map ----
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function asChoice(a: Answer): ChoiceAnswer {
  if (a.type !== "choice") throw new Error(`expected choice answer, got ${a.type}`);
  return a;
}
function asScore(a: Answer): ScoreAnswer {
  if (a.type !== "score") throw new Error(`expected score answer, got ${a.type}`);
  return a;
}
function asNoul(a: Answer): NoulAnswer {
  if (a.type !== "noul") throw new Error(`expected noul answer, got ${a.type}`);
  return a;
}

const COST_PER_1M_INPUT = 0.042;

export async function decide(words: Word[], perception: Perception, meta: { title: string }): Promise<Decisions> {
  const target = getJevTarget();
  const beats = splitShots(words);
  const footage = footageContext(perception);
  const transcript = numberedTranscript(beats);

  const latencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const wallStart = Date.now();

  // ---- global request ----
  const globalQuestions: Record<string, Question> = {
    style_family: { type: "choice", instructions: "Pick the single visual style family that best fits this whole video's content and tone.", criteria: STYLE_FAMILY_MENU },
    accent: { type: "choice", instructions: "Pick the single accent color that best fits this whole video's mood.", criteria: ACCENT_MENU },
    caption_style: { type: "choice", instructions: "Pick the caption style that best fits this whole video's pacing and content.", criteria: CAPTION_STYLE_MENU },
    hook_style: { type: "choice", instructions: "Pick the opening-title look that best fits how this video opens, judged from the first sentences.", criteria: HOOK_MENU },
    energy: { type: "score", instructions: "Rate the overall energy/delivery level of the speaker across this whole video.", criteria: ENERGY_SCORE_CRITERIA },
    progress_bar: {
      type: "noul",
      instructions: "Should a subtle playback progress bar be shown for this video?",
      criteria: {
        true: "The content is structured/informational (a list, a walkthrough, a step-by-step explainer) where viewers benefit from knowing how far along they are.",
        false: "The content is a punchy standalone clip where a progress bar would just be visual clutter.",
      },
    },
  };
  const globalState = { footage, title: meta.title, transcript };

  const globalPromise = callSystemOne(target, globalState, globalQuestions);

  // ---- per-section caption style (section 0 keeps the global answer, which also styles the hook) ----
  const sections = buildSections(beats, words);
  const sectionPromises = sections.map((sec, k) => {
    if (k === 0) return null;
    const text = beats.slice(sec.first, sec.last + 1).map(b => b.text).join(" ");
    return callSystemOne(
      target,
      { footage, title: meta.title, transcript, current: `>>> CURRENT SECTION (${k + 1} of ${sections.length}): "${text}"` },
      {
        caption_style: {
          type: "choice",
          instructions: "Pick the caption style that best fits the delivery and content of CURRENT SECTION. Different sections may use different styles.",
          criteria: CAPTION_STYLE_MENU,
        },
      },
    );
  });

  // ---- per-beat requests ----
  const beatResults = await mapLimit(beats, 32, async (beat, idx) => {
    const prev = idx > 0 ? beats[idx - 1].text : "";
    const next = idx < beats.length - 1 ? beats[idx + 1].text : "";
    const state = {
      footage,
      transcript,
      currentShot: idx + 1,
      current: `>>> CURRENT SHOT ${idx + 1}: "${beat.text}"`,
      prev,
      next,
    };

    const candidates = contentWordCandidates(beat, words);
    const emphasisCriteria: Record<string, string> = {};
    for (const c of candidates) emphasisCriteria[c.id] = `the word "${c.text}"`;

    const questions: Record<string, Question> = {
      overlay: {
        type: "choice",
        instructions: "What should be drawn on the screen for CURRENT SHOT, besides the captions and the speaker?",
        criteria: OVERLAY_MENU,
      },
      camera: {
        type: "choice",
        instructions: "How should the camera treat the speaker during CURRENT SHOT, given PREV and NEXT?",
        criteria: CAMERA_MENU,
      },
      template: { type: "choice", instructions: "Which visual template best fits the content of CURRENT SHOT?", criteria: templateChoiceCriteria() },
      text_effect: { type: "choice", instructions: "Which caption text-reveal effect best fits CURRENT SHOT's tone?", criteria: TEXT_EFFECT_MENU },
      transition: { type: "choice", instructions: "Which transition (if any) should play on the cut INTO CURRENT SHOT, given PREV?", criteria: TRANSITION_MENU },
      sfx: { type: "choice", instructions: "Which sound effect (if any) best punctuates the cut into CURRENT SHOT?", criteria: SFX_MENU },
      ...(candidates.length >= 2
        ? { emphasis: { type: "choice", instructions: "Which single word in CURRENT SHOT is the most important one to visually emphasize?", criteria: emphasisCriteria } as Question }
        : {}),
    };

    const result = await callSystemOne(target, state, questions);
    return { beat, result };
  });

  const globalResult = await globalPromise;
  latencies.push(globalResult.latencyMs);
  inputTokens += (globalResult.response.usage?.input_tokens ?? 0);
  outputTokens += (globalResult.response.usage?.output_tokens ?? 0);

  const global: GlobalDecisions = {
    family: { choice: asChoice(globalResult.response.answers.style_family).choice as any, probabilities: asChoice(globalResult.response.answers.style_family).probabilities, confidence: asChoice(globalResult.response.answers.style_family).confidence },
    accent: { choice: asChoice(globalResult.response.answers.accent).choice as any, probabilities: asChoice(globalResult.response.answers.accent).probabilities, confidence: asChoice(globalResult.response.answers.accent).confidence },
    captionStyle: { choice: asChoice(globalResult.response.answers.caption_style).choice as any, probabilities: asChoice(globalResult.response.answers.caption_style).probabilities, confidence: asChoice(globalResult.response.answers.caption_style).confidence },
    energy: { score: asScore(globalResult.response.answers.energy).score, probabilities: asScore(globalResult.response.answers.energy).probabilities, confidence: asScore(globalResult.response.answers.energy).confidence },
    progressBar: { noul: asNoul(globalResult.response.answers.progress_bar).noul },
    hookStyle: globalResult.response.answers.hook_style
      ? { choice: asChoice(globalResult.response.answers.hook_style).choice as any, probabilities: asChoice(globalResult.response.answers.hook_style).probabilities, confidence: asChoice(globalResult.response.answers.hook_style).confidence }
      : undefined,
  };

  const sectionDecisions: SectionDecision[] = [];
  for (let k = 0; k < sections.length; k++) {
    const sec = sections[k];
    let captionStyle = global.captionStyle;
    const pending = sectionPromises[k];
    if (pending) {
      const r = await pending;
      latencies.push(r.latencyMs);
      inputTokens += r.response.usage?.input_tokens ?? 0;
      outputTokens += r.response.usage?.output_tokens ?? 0;
      const ans = asChoice(r.response.answers.caption_style);
      captionStyle = { choice: ans.choice as any, probabilities: ans.probabilities, confidence: ans.confidence };
    }
    sectionDecisions.push({ firstShot: beats[sec.first].id, lastShot: beats[sec.last].id, start: sec.start, end: sec.end, captionStyle });
  }
  global.sections = sectionDecisions;

  const beatDecisions: BeatDecision[] = beatResults.map(({ beat, result }) => {
    latencies.push(result.latencyMs);
    inputTokens += (result.response.usage?.input_tokens ?? 0);
    outputTokens += (result.response.usage?.output_tokens ?? 0);
    const a = result.response.answers;
    const emphasisAns = a.emphasis ? asChoice(a.emphasis) : null;
    const overlayAns = asChoice(a.overlay);
    const cameraAns = asChoice(a.camera);
    const op = overlayAns.probabilities;
    // "a graphic is wanted" = the odds of either graphic overlay; a giant word or nothing leaves the picture to the face
    const needsVisual = Math.min(1, (op.card ?? 0) + (op.keyword_pill ?? 0));
    const tplAns = asChoice(a.template);
    let tplChoice = tplAns.choice as TemplateId;
    if (overlayAns.choice === "keyword_pill") tplChoice = "keyword_pill";
    else if (overlayAns.choice === "card" && tplChoice === "keyword_pill") {
      // the card menu was picked, so the card is not the small pill: take the best real card template
      const best = Object.entries(tplAns.probabilities)
        .filter(([id]) => id !== "keyword_pill")
        .sort((x, y) => y[1] - x[1])[0];
      if (best) tplChoice = best[0] as TemplateId;
    }
    return {
      beatId: beat.id,
      needsVisual,
      overlay: { choice: overlayAns.choice as any, probabilities: overlayAns.probabilities, confidence: overlayAns.confidence },
      camera: { choice: cameraAns.choice as any, probabilities: cameraAns.probabilities, confidence: cameraAns.confidence },
      template: { choice: tplChoice, probabilities: tplAns.probabilities, confidence: tplAns.confidence },
      textEffect: { choice: asChoice(a.text_effect).choice as any, probabilities: asChoice(a.text_effect).probabilities, confidence: asChoice(a.text_effect).confidence },
      transition: { choice: asChoice(a.transition).choice as any, probabilities: asChoice(a.transition).probabilities, confidence: asChoice(a.transition).confidence },
      punchIn: cameraAns.probabilities.punch ?? 0,
      sfx: { choice: asChoice(a.sfx).choice, probabilities: asChoice(a.sfx).probabilities, confidence: asChoice(a.sfx).confidence },
      emphasis: emphasisAns ? { choice: emphasisAns.choice, probabilities: emphasisAns.probabilities, confidence: emphasisAns.confidence } : null,
    };
  });

  const wallMs = Date.now() - wallStart;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const stats: JevStats = {
    requestCount: latencies.length,
    latenciesMs: latencies,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    wallMs,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens / 1_000_000) * COST_PER_1M_INPUT,
  };

  return { global, beats: beatDecisions, stats };
}
