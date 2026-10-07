/** Shared types for the clean stage. All times are seconds. */

export type CutReason = "retake" | "silence" | "filler" | "lead" | "tail";

/** A voiced span with no transcribed words that the cutter refused to delete. */
export interface KeptSpan {
  start: number;
  end: number;
  reason: "untranscribed_kept";
}

/** A span of the raw source that is removed from the cleaned video. */
export interface Cut {
  start: number;
  end: number;
  reason: CutReason;
  /** Words that were spoken inside the removed span (empty for pure silence). */
  text: string;
  /** Jev's probability that the span is an abandoned take, for retake cuts. */
  jev?: number;
}

/** A span of the raw source that is kept, in source time. */
export interface Range {
  start: number;
  end: number;
}

/** A stretch of the audio that ffmpeg silencedetect found quiet. */
export type Interval = Range;

export interface CleanOptions {
  /** Longest true silence (measured on the audio, not the word times) between kept words that is left alone. */
  maxGap: number;
  /** Silence kept after a word before a cut. */
  padAfter: number;
  /** Silence kept before a word after a cut. */
  padBefore: number;
  /** Same two pads for a join inside a phrase (the earlier word has no punctuation). */
  phrasePadAfter: number;
  phrasePadBefore: number;
  /** Non-word sound shorter than this is not a filler. */
  fillerMin: number;
  /** Non-word sound longer than this is left alone (could be real speech). */
  fillerMax: number;
}

export interface LoudnormMeasure {
  inputI: number;
  inputTP: number;
  inputLRA: number;
  inputThresh: number;
  targetOffset: number;
}

export interface CleanStats {
  /** Duration of the raw source. */
  beforeSec: number;
  /** Duration of clean.mp4. */
  afterSec: number;
  /** Seconds removed, by reason. */
  removedSec: Record<CutReason, number>;
  /** Retake spans that were cut (a triple take counts as two). */
  retakesCut: number;
  /** Cuts with reason "filler" (explicit tokens plus voiced non-word sounds). */
  fillersCut: number;
  /** Words added by re-transcribing voiced spans the first pass left empty. */
  recoveredWords?: number;
  /** Voiced spans with no words that were kept rather than cut (reason "untranscribed_kept"). */
  untranscribedKept?: number;
  /** Whether Jev confirmed the retakes, or the deterministic fallback decided. */
  retakeMode: "jev" | "fallback" | "none";
  jevCalls: number;
  jevLatencyMs: number[];
}
