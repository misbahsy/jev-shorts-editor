/**
 * The words of the cleaned clip, as heard. After clean.mp4 is rendered it is transcribed again
 * and those words (already on the output clock) become the captions, beats and copy source.
 * Mapping the raw words through the cuts guesses which words survived; listening to the result
 * cannot disagree with what the viewer hears. Pure helpers here; the caller supplies the ASR.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Word } from "../transcribe";
import { REFINE_MAX_DB, REFINE_OFFSET_DB } from "./constants";
import { snapWordsToEdges, wordEdges } from "./edges";
import { adaptiveSilenceDb, detectSilence, loudnessEnvelope } from "./ffmpegTools";
import { refineWords } from "./refine";
import type { Retranscribe } from "./recover";

/** A transcript of the cleaned clip with fewer words than this share of the guess is not believed. */
export const HEARD_MIN_SHARE = 0.6;

export interface HeardResult {
  words: Word[];
  /** Words the cut-mapping expected that the second transcript does not contain. */
  missing: number;
  /** Words in the second transcript that the cut-mapping did not expect. */
  extra: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Counts how the guess (raw words mapped through the cuts) and the heard words differ, by an
 * in-order walk with a small look-ahead. Only used for the log line and the sanity check.
 */
export function compareWords(guess: Word[], heard: Word[]): { missing: number; extra: number } {
  let g = 0;
  let h = 0;
  let missing = 0;
  let extra = 0;
  const LOOK = 3;
  while (g < guess.length && h < heard.length) {
    if (norm(guess[g].text) === norm(heard[h].text)) { g++; h++; continue; }
    let hit = false;
    for (let d = 1; d <= LOOK && !hit; d++) {
      if (h + d < heard.length && norm(guess[g].text) === norm(heard[h + d].text)) { extra += d; h += d; hit = true; }
      else if (g + d < guess.length && norm(guess[g + d].text) === norm(heard[h].text)) { missing += d; g += d; hit = true; }
    }
    if (!hit) { missing++; extra++; g++; h++; }
  }
  return { missing: missing + (guess.length - g), extra: extra + (heard.length - h) };
}

/**
 * Transcribes the cleaned clip and puts the words on the real sound edges of that clip. Throws
 * when the ASR fails or returns far fewer words than the cut-mapping expected, so the caller can
 * fall back to the mapped words.
 */
export async function transcribeCleaned(args: {
  cleanPath: string;
  workDir: string;
  durationSec: number;
  /** The cut-mapped words, used only as a sanity check. */
  guess: Word[];
  transcribe: Retranscribe;
}): Promise<HeardResult> {
  const { cleanPath, workDir, durationSec, guess } = args;
  const dir = join(workDir, "heard");
  mkdirSync(dir, { recursive: true });
  const raw = await args.transcribe(cleanPath, dir);
  if (raw.length === 0) throw new Error("the cleaned clip transcribed to no words");
  if (guess.length > 0 && raw.length < guess.length * HEARD_MIN_SHARE) {
    throw new Error(`the cleaned clip transcribed to ${raw.length} words, the cuts leave about ${guess.length}`);
  }
  // the same word-edge treatment the raw words get, on the cleaned clip's own audio
  const env = loudnessEnvelope(cleanPath);
  const thr = adaptiveSilenceDb(env);
  const edgeDb = Math.min(REFINE_MAX_DB, thr.thresholdDb + REFINE_OFFSET_DB);
  const refined = refineWords(raw, detectSilence(cleanPath, edgeDb, 0.1, durationSec));
  const snapped = snapWordsToEdges(refined, wordEdges(env, refined, durationSec)).map((w, i) => ({ ...w, i }));
  const { missing, extra } = compareWords(guess, snapped);
  return { words: snapped, missing, extra };
}
