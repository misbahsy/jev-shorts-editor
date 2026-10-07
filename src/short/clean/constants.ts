import type { CleanOptions } from "./types";

export const DEFAULT_CLEAN: CleanOptions = {
  maxGap: 0.35,
  padAfter: 0.12,
  padBefore: 0.1,
  fillerMin: 0.15,
  fillerMax: 1.2,
};

/** Jev must give at least this probability before a retake candidate is cut. */
export const JEV_CUT_THRESHOLD = 0.5;
/**
 * A whole chain of overlapping candidates (several takes in a row) needs a little less: every
 * link already shares several words with the next, and reading the chain as one span is harder
 * for the classifier than reading one link.
 */
export const JEV_CHAIN_THRESHOLD = 0.4;
/** Without Jev, only candidates matching at least this many words are cut. */
export const FALLBACK_MIN_MATCH = 5;
/** Questions per Jev request. */
export const JEV_BATCH = 64;
export const JEV_CONCURRENCY = 4;

/** A retake candidate pairs an earlier span with a later one within this window. */
export const RETAKE_WINDOW_WORDS = 60;
export const RETAKE_WINDOW_SEC = 30;
/** Fade at each join, so a cut never clicks. */
export const JOIN_FADE_SEC = 0.03;
/** Joins that remove less than this are not worth a framing change. */
export const MIN_VISIBLE_CUT_SEC = 0.2;
/** Cuts closer together than this share one framing change. */
export const CUT_COLLAPSE_SEC = 1.5;

export const FILLER_TOKENS = new Set(["um", "uh", "umm", "uhh", "uhm", "erm", "hmm", "mmm"]);

/** A pause this long before a word counts as a take boundary even without punctuation. */
export const TAKE_BOUNDARY_GAP_SEC = 0.2;

/** Word-edge refinement threshold: dead-air threshold plus this offset, never above the cap. */
export const REFINE_OFFSET_DB = 10;
export const REFINE_MAX_DB = -48;
