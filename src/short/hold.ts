/**
 * Stage: holdMerge — deterministic, runs before assembleStructure.
 * When Jev picks the SAME template for adjacent beats (or A-B-A with a short B), the beats are
 * one idea: merge them into a single beat so one card holds on screen instead of being
 * re-picked to a different template and flickering every ~2s.
 */
import type { RawBeat, Decisions, BeatDecision, TemplateId } from "./types";
import { MAX_DEAD_RUN_SEC } from "./structure";

const MAX_HOLD_SEC = 9;
const SHORT_MIDDLE_SEC = 2.5;
// templates whose consecutive uses are genuinely different cards (point 1, point 2, ...)
const NO_HOLD = new Set<TemplateId>(["numbered_point", "stamp", "keyword_pill"]);
// Coverage-floor remedy #1 (see structure.ts MAX_DEAD_RUN_SEC / the file doc there for the full
// rationale): when a dead run would exceed MAX_DEAD_RUN_SEC, prefer extending the PRECEDING visual
// beat's card across it rather than manufacturing a new card. This is the same on-screen situation
// as an ordinary hold (one card, no re-entry animation) so it gets the same ceiling as MAX_HOLD_SEC
// — past that, the same static card sitting there stops reading as deliberate pacing and starts
// reading as stale/broken. Whatever dead time is left after hitting this cap is left for
// structure.ts's guarded promotion fallback (remedy #2) instead.
const MAX_EXTEND_SEC = MAX_HOLD_SEC;

type Held = BeatDecision & { heldEmphasis?: string[] };

function mergeGroup(beats: RawBeat[], decs: BeatDecision[], tpl: TemplateId): { beat: RawBeat; dec: Held } {
  const first = beats[0];
  const last = beats[beats.length - 1];
  const beat: RawBeat = {
    id: first.id,
    start: first.start,
    end: last.end,
    text: beats.map(b => b.text).join(" "),
    wordRange: [first.wordRange[0], last.wordRange[1]],
  };
  const best = decs.reduce((a, b) => ((b.template.probabilities[tpl] ?? 0) > (a.template.probabilities[tpl] ?? 0) ? b : a));
  const heldEmphasis = decs.map(d => d.emphasis?.choice).filter((c): c is string => !!c);
  const dec: Held = {
    ...decs[0],
    needsVisual: Math.max(...decs.map(d => d.needsVisual)),
    template: { ...best.template, choice: tpl },
    emphasis: best.emphasis,
    heldEmphasis,
  };
  return { beat, dec };
}

export function holdMerge(beats: RawBeat[], decisions: Decisions): { beats: RawBeat[]; decisions: Decisions } {
  const outBeats: RawBeat[] = [];
  const outDecs: BeatDecision[] = [];
  const wantsVisual = (d: BeatDecision) => d.needsVisual >= 0.5;
  let i = 0;
  while (i < beats.length) {
    const tpl = decisions.beats[i].template.choice;
    let j = i;
    if (wantsVisual(decisions.beats[i]) && !NO_HOLD.has(tpl)) {
      for (;;) {
        const n1 = j + 1;
        const n2 = j + 2;
        const same = (k: number) => k < beats.length && wantsVisual(decisions.beats[k]) && decisions.beats[k].template.choice === tpl;
        if (same(n1) && beats[n1].end - beats[i].start <= MAX_HOLD_SEC) j = n1;
        else if (
          n2 < beats.length && same(n2) &&
          beats[n1].end - beats[n1].start < SHORT_MIDDLE_SEC &&
          beats[n2].end - beats[i].start <= MAX_HOLD_SEC
        ) j = n2;
        else break;
      }
    }
    if (j === i) {
      outBeats.push(beats[i]);
      outDecs.push(decisions.beats[i]);
    } else {
      const m = mergeGroup(beats.slice(i, j + 1), decisions.beats.slice(i, j + 1), tpl);
      outBeats.push(m.beat);
      outDecs.push(m.dec);
    }
    i = j + 1;
  }
  return { beats: outBeats, decisions: { ...decisions, beats: outDecs } };
}

/** Same "wants a card" predicate structure.ts's initial assignment uses (dec.needsVisual >= 0.5,
 * plus the beat-0 override so the short never opens on a dead frame) — this function has to agree
 * with structure.ts about which beats are dead, since it runs first and structure.ts inherits
 * whatever beat list comes out of it. */
function wantsVisualAt(decisions: Decisions, idx: number): boolean {
  return decisions.beats[idx].needsVisual >= 0.5 || idx === 0;
}

/**
 * Coverage-floor remedy #1: when a run of visual-less beats immediately following a visual beat
 * would exceed MAX_DEAD_RUN_SEC, absorb as many of those dead beats as fit under MAX_EXTEND_SEC
 * into the preceding visual beat, extending its card across them instead of generating a new one.
 * The merged beat keeps the SAME template/decision as the beat it grew from (we're holding the
 * existing card longer, not writing new copy for it) — only its time span, text and wordRange grow
 * to cover the words spoken during the extension, so captions/word-range-derived timing stay
 * accurate.
 *
 * Runs are only touched when already over budget; a short breather is left alone. Must run AFTER
 * holdMerge (so same-template consolidation happens first) and BEFORE assembleStructure, since it
 * changes beat time spans — something assembleStructure does not own (its beats param is given,
 * 1:1 with its output). Whatever dead run remains after this (run still over budget, or no
 * preceding visual beat at all) is handled by structure.ts's guarded promotion fallback.
 */
export function extendOverDeadRuns(beats: RawBeat[], decisions: Decisions): { beats: RawBeat[]; decisions: Decisions } {
  const outBeats: RawBeat[] = [];
  const outDecs: BeatDecision[] = [];
  let i = 0;
  while (i < beats.length) {
    if (!wantsVisualAt(decisions, i)) {
      // dead beat with nothing preceding it to extend from in this pass -- left for structure.ts
      outBeats.push(beats[i]);
      outDecs.push(decisions.beats[i]);
      i++;
      continue;
    }
    // measure the full dead run immediately following this visual beat
    let runEnd = i;
    while (runEnd + 1 < beats.length && !wantsVisualAt(decisions, runEnd + 1)) runEnd++;
    const runDur = runEnd > i ? beats[runEnd].end - beats[i + 1].start : 0;
    if (runEnd === i || runDur <= MAX_DEAD_RUN_SEC) {
      // no dead run follows, or it's already within budget -- leave it alone
      outBeats.push(beats[i]);
      outDecs.push(decisions.beats[i]);
      i++;
      continue;
    }
    // absorb dead beats greedily while the extended span stays under the cap
    let j = i;
    while (j + 1 <= runEnd && beats[j + 1].end - beats[i].start <= MAX_EXTEND_SEC) j++;
    if (j === i) {
      // cap doesn't allow absorbing even the first dead beat -- nothing to extend
      outBeats.push(beats[i]);
      outDecs.push(decisions.beats[i]);
      i++;
      continue;
    }
    const first = beats[i];
    const last = beats[j];
    const mergedBeat: RawBeat = {
      id: first.id,
      start: first.start,
      end: last.end,
      text: beats.slice(i, j + 1).map(b => b.text).join(" "),
      wordRange: [first.wordRange[0], last.wordRange[1]],
    };
    outBeats.push(mergedBeat);
    outDecs.push(decisions.beats[i]);
    i = j + 1;
  }
  return { beats: outBeats, decisions: { ...decisions, beats: outDecs } };
}
