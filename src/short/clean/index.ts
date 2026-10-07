/**
 * The clean stage. Takes a raw talking-head clip and produces clean.mp4 (retakes, dead air and
 * filler sounds removed), the word list on the new clock, and work/clean.json describing every
 * cut. Everything after this stage works on clean.mp4, so output time equals source time there.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transcribe, type Word } from "../transcribe";
import { DEFAULT_CLEAN, FILLER_TOKENS } from "./constants";
import { adaptiveSilenceDb, detectSilence, loudnessEnvelope, measureLoudnorm } from "./ffmpegTools";
import { confirmRetakes, type Confirmed, type JevCall } from "./confirm";
import { cutVideo } from "./cut";
import { snapWordsToEdges, wordEdges } from "./edges";
import { findFillerSounds, planKeep } from "./keep";
import { refineWords } from "./refine";
import { REFINE_MAX_DB, REFINE_OFFSET_DB } from "./constants";
import { cutPoints, keptDuration, remapWords } from "./remap";
import { selectTakes, type TakesCall } from "./takes";
import { recoverUntranscribed, spansToProtect, type Retranscribe } from "./recover";
import { findRetakeCandidates, mergeSpans, normWord, type RetakeCandidate } from "./retakes";
import type { CleanOptions, CleanStats, Cut, CutReason, KeptSpan, LoudnormMeasure, Range } from "./types";

export interface CleanResult {
  /** Path of clean.mp4. */
  cleanPath: string;
  /** Surviving words with times on the clean.mp4 clock. */
  words: Word[];
  keeps: Range[];
  cuts: Cut[];
  /** Output-time seconds where the framing should alternate. */
  cutPoints: number[];
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  /** Voiced spans without words that were kept rather than cut. */
  keptSpans: KeptSpan[];
  /** Loudnorm pass 1 measured on clean.mp4, for the final render's second pass. */
  loudness: LoudnormMeasure;
  stats: CleanStats;
}

export interface CleanOptionsIn {
  /** Raw words with precise ends. Skips transcription (used by tests and the dev CLI). */
  words?: Word[];
  options?: Partial<CleanOptions>;
  /** Replaces the Jev call (tests). */
  jev?: JevCall;
  /** Replaces the Groq call that picks takes (tests). */
  takes?: TakesCall;
  /** Set false to skip the LLM take selection. */
  selectTakes?: boolean;
  /** Replaces the parakeet call that re-transcribes untranscribed voiced spans (tests). */
  retranscribe?: Retranscribe;
  /** Set false to skip the second look at voiced spans that have no words. */
  recover?: boolean;
  /** Skips the ffmpeg cut and the loudness pass: plan only. */
  dryRun?: boolean;
  log?: (m: string) => void;
}

interface Probe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
}

function probe(src: string): Probe {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,sample_rate:format=duration", "-of", "json", src],
    { encoding: "utf8" },
  );
  const j = JSON.parse(out) as {
    streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; sample_rate?: string }[];
    format: { duration: string };
  };
  const v = j.streams.find(s => s.codec_type === "video");
  const a = j.streams.find(s => s.codec_type === "audio");
  if (!v) throw new Error("source has no video stream");
  if (!a) throw new Error("source has no audio stream");
  const [n, d] = (v.r_frame_rate ?? "30/1").split("/").map(Number);
  return {
    durationSec: Number(j.format.duration),
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: d ? n / d : n,
    sampleRate: Number(a.sample_rate ?? 48000),
  };
}

const emptyReasons = (): Record<CutReason, number> => ({ retake: 0, silence: 0, filler: 0, lead: 0, tail: 0 });

function wordsText(words: Word[], a: number, b: number): string {
  return words.slice(a, b).map(w => w.text).join(" ");
}

export async function cleanSource(srcPath: string, workDir: string, input: CleanOptionsIn = {}): Promise<CleanResult> {
  const log = input.log ?? (() => {});
  const opts: CleanOptions = { ...DEFAULT_CLEAN, ...input.options };
  mkdirSync(workDir, { recursive: true });
  const pr = probe(srcPath);

  const rawWords = input.words ?? (await transcribe(srcPath, workDir, { preciseEnds: true }));

  // audio analysis: a threshold from this clip's own levels, then silence intervals
  const env = loudnessEnvelope(srcPath);
  const thr = adaptiveSilenceDb(env);
  const silences = detectSilence(srcPath, thr.thresholdDb, 0.1, pr.durationSec);
  log(`clean: silence threshold ${thr.thresholdDb.toFixed(1)} dB (floor ${thr.floorDb.toFixed(1)}, speech ${thr.speechDb.toFixed(1)}), ${silences.length} silences`);
  // Word edges snap to a slightly looser threshold than the dead-air one: breath and room tone
  // just before an onset sit above the dead-air level but are still not speech.
  const edgeDb = Math.min(REFINE_MAX_DB, thr.thresholdDb + REFINE_OFFSET_DB);
  const edgeSilences = edgeDb > thr.thresholdDb ? detectSilence(srcPath, edgeDb, 0.1, pr.durationSec) : silences;
  let words = refineWords(rawWords, edgeSilences);

  // Voiced audio with no words is never cut just for lacking words: re-transcribe those spans
  // (one batch) and merge what comes back. Spans that stay empty are handled by the planner.
  let stillEmpty: Awaited<ReturnType<typeof recoverUntranscribed>>["stillEmpty"] = [];
  let recoveredWords = 0;
  if (input.recover !== false) {
    const rec = await recoverUntranscribed({
      src: srcPath,
      workDir,
      words,
      silences,
      durationSec: pr.durationSec,
      retranscribe: input.retranscribe ?? ((audio, dir) => transcribe(audio, dir, { preciseEnds: true })),
      log,
    });
    words = rec.words;
    stillEmpty = rec.stillEmpty;
    recoveredWords = rec.added.length;
  }

  // retakes: deterministic candidates, Jev confirms
  const cands = findRetakeCandidates(words);
  const conf = await confirmRetakes(words, cands, input.jev, log);
  // a candidate fully inside another accepted one is the same retake, not a second one
  const accepted: Confirmed[] = conf.accepted.filter(
    a => !conf.accepted.some(o => o !== a && o.cand.start <= a.cand.start && o.cand.end >= a.cand.end && (o.cand.start < a.cand.start || o.cand.end > a.cand.end)),
  );
  const removed = new Map<number, "retake" | "filler">();
  for (const s of mergeSpans(conf.accepted.map(a => a.cand))) for (let i = s.start; i < s.end; i++) removed.set(i, "retake");

  // take selection: an LLM adds drops the n-gram pass missed; code guards every proposal
  const jevRemoved = new Set(removed.keys());
  const sel = await selectTakes({
    words,
    alreadyRemoved: jevRemoved,
    call: input.selectTakes === false ? undefined : input.takes,
    log,
    ...(input.selectTakes === false ? { off: true } : {}),
  });
  for (const i of sel.drops.keys()) removed.set(i, "retake");

  // explicit filler tokens, but only when there is air on at least one side of the word
  for (const w of words) {
    if (removed.has(w.i) || !FILLER_TOKENS.has(normWord(w.text))) continue;
    const before = w.i > 0 ? w.start - words[w.i - 1].end : 1;
    const after = w.i < words.length - 1 ? words[w.i + 1].start - w.end : 1;
    if (before >= 0.03 && after >= 0.03) removed.set(w.i, "filler");
  }
  const fillerSounds = findFillerSounds(words, silences, pr.durationSec, opts);

  const protect = spansToProtect(stillEmpty, new Set(removed.keys()));
  const plan = planKeep({ words, removed, fillerSounds, durationSec: pr.durationSec, fps: pr.fps, opts, envelope: env, protect });
  const keptSpans: KeptSpan[] = protect.map(p => ({ start: +p.start.toFixed(3), end: +p.end.toFixed(3), reason: "untranscribed_kept" as const }));
  if (keptSpans.length) log(`clean: kept ${keptSpans.length} voiced spans with no words (${keptSpans.map(k => `${k.start.toFixed(1)}-${k.end.toFixed(1)}`).join(", ")})`);
  const afterSec = keptDuration(plan.keeps);

  const cleanPath = join(workDir, "clean.mp4");
  let loudness: LoudnormMeasure = { inputI: 0, inputTP: 0, inputLRA: 0, inputThresh: 0, targetOffset: 0 };
  if (!input.dryRun) {
    cutVideo({ src: srcPath, out: cleanPath, keeps: plan.keeps, fps: pr.fps, sampleRate: pr.sampleRate, scriptPath: join(workDir, "clean.filter.txt") });
    loudness = measureLoudnorm(cleanPath);
  }

  // every cut says what decided it; retake cuts also carry the LLM's reason
  const wordsIn = (c: Cut) => words.filter(w => w.start < c.end && w.end > c.start && removed.has(w.i)).map(w => w.i);
  for (const c of plan.cuts) {
    if (c.reason !== "retake") { c.source = "rule"; continue; }
    const idx = wordsIn(c);
    const byJev = idx.some(i => jevRemoved.has(i));
    const llm = idx.filter(i => sel.drops.has(i));
    c.source = byJev && llm.length ? "jev+llm" : llm.length ? "llm" : "jev";
    if (llm.length) c.why = [...new Set(llm.map(i => sel.drops.get(i) as string))].join("; ");
  }

  // each retake cut carries the highest Jev score among the candidates inside it
  for (const c of plan.cuts) {
    if (c.reason !== "retake") continue;
    const scores = accepted
      .filter(a => a.jev !== undefined && words[a.cand.start].start >= c.start - 1 && words[a.cand.end - 1].end <= c.end + 1)
      .map(a => a.jev as number);
    if (scores.length) c.jev = Math.max(...scores);
  }

  const removedSec = emptyReasons();
  for (const c of plan.cuts) removedSec[c.reason] += c.end - c.start;
  const stats: CleanStats = {
    beforeSec: pr.durationSec,
    afterSec,
    removedSec,
    retakesCut: accepted.length,
    // the same rows clean.json lists, so the count and the file always agree
    fillersCut: plan.cuts.filter(c => c.reason === "filler").length,
    recoveredWords,
    untranscribedKept: keptSpans.length,
    retakeMode: conf.mode,
    jevCalls: conf.calls,
    jevLatencyMs: conf.latencyMs,
    takeSelection: sel.mode,
    llmDrops: plan.cuts.filter(c => c.source === "llm").length,
  };

  // captions use the real sound edges, so every kept word sits inside a keep range
  const outWords = remapWords(snapWordsToEdges(words, wordEdges(env, words, pr.durationSec)), plan.keeps);
  const points = cutPoints(plan.keeps);

  const considered = (conf.scored.length ? conf.scored.map(s => s.cand) : cands).map((c: RetakeCandidate) => {
    const hit = conf.scored.find(a => a.cand === c);
    const covered = conf.accepted.some(a => a.cand.start <= c.start && a.cand.end >= c.end);
    return { start: words[c.start].start, end: words[c.end - 1].end, kind: c.kind, strength: c.strength, text: wordsText(words, c.start, c.end), cut: covered, jev: hit?.jev };
  });
  writeFileSync(
    join(workDir, "clean.json"),
    JSON.stringify(
      {
        beforeSec: pr.durationSec,
        afterSec,
        silenceThresholdDb: thr.thresholdDb,
        retakeMode: conf.mode,
        stats,
        cuts: plan.cuts.map(c => ({ start: +c.start.toFixed(3), end: +c.end.toFixed(3), reason: c.reason, text: c.text, source: c.source, ...(c.why ? { why: c.why } : {}), ...(c.jev !== undefined ? { jev: c.jev } : {}) })),
        keeps: plan.keeps,
        takeSelection: { mode: sel.mode, model: sel.model, latencyMs: sel.latencyMs, warning: sel.warning, decisions: sel.decisions },
        kept: keptSpans,
        candidates: considered,
        loudnorm: loudness,
      },
      null,
      2,
    ),
  );

  return {
    cleanPath, words: outWords, keeps: plan.keeps, cuts: plan.cuts, cutPoints: points, durationSec: afterSec,
    fps: pr.fps, width: pr.width, height: pr.height, loudness, keptSpans, stats,
  };
}
