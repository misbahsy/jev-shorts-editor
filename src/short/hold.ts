/**
 * Stage: holdMerge — deterministic, runs before assembleStructure.
 * When Jev picks the SAME template for adjacent beats (or A-B-A with a short B), the beats are
 * one idea: merge them into a single beat so one card holds on screen instead of being
 * re-picked to a different template and flickering every ~2s. The units are 2 to 3 second shots
 * (shots.ts), so a merged beat is usually two shots; the hold cap depends on the layout.
 */
import type { RawBeat, Decisions, BeatDecision, TemplateId } from "./types";
import { isUnderChin } from "./menus";

/** How long one card may sit on screen. Under-the-chin cards ride on the full-bleed speaker, whose
 * camera keeps changing underneath, so they can stay longer; a split card is static next to a still
 * speaker, so it is swapped sooner. */
export const MAX_HOLD_UNDER_CHIN_SEC = 5.5;
export const MAX_HOLD_SPLIT_SEC = 3.4;
const SHORT_MIDDLE_SEC = 2.5;
// templates whose consecutive uses are genuinely different cards (point 1, point 2, ...)
const NO_HOLD = new Set<TemplateId>(["numbered_point", "stamp", "keyword_pill"]);

export const maxHoldSec = (tpl: TemplateId) => (isUnderChin(tpl) ? MAX_HOLD_UNDER_CHIN_SEC : MAX_HOLD_SPLIT_SEC);

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
    const maxHold = maxHoldSec(tpl);
    let j = i;
    if (wantsVisual(decisions.beats[i]) && !NO_HOLD.has(tpl)) {
      for (;;) {
        const n1 = j + 1;
        const n2 = j + 2;
        const same = (k: number) => k < beats.length && wantsVisual(decisions.beats[k]) && decisions.beats[k].template.choice === tpl;
        if (same(n1) && beats[n1].end - beats[i].start <= maxHold) j = n1;
        else if (
          n2 < beats.length && same(n2) &&
          beats[n1].end - beats[n1].start < SHORT_MIDDLE_SEC &&
          beats[n2].end - beats[i].start <= maxHold
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
