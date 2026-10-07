/**
 * Stage: assembleStructure — deterministic, no LLM/Jev calls.
 * Turns raw per-beat Jev decisions into a FINAL structure (layout, template,
 * textEffect, transition, punchIn) BEFORE any copy is written, so fillCopy
 * only ever generates fields for the template a beat will actually use.
 *
 * Variety re-picks (template / textEffect / transition) use the beat's own
 * Jev probability distribution ("next-highest-probability"), never a fixed
 * fallback template — that was the ordering bug in the previous version
 * (variety enforcement ran AFTER copy, so a forced template swap left the
 * beat's generated fields orphaned and assemble.ts had to paper over it with
 * a degenerate big_statement restatement).
 */
import type { RawBeat, Decisions, BeatDecision, TemplateId, TextEffectId, TransitionId } from "./types";
import { isUnderChin } from "./menus";

export interface BeatStructure {
  beatId: string;
  hasVisual: boolean;
  template: TemplateId | null;
  layout: "full" | "split";
  textEffect: TextEffectId;
  transition: TransitionId; // the beat's own (possibly variety-enforced) transition choice
  transitionIn: TransitionId; // hard_cut unless layout/template actually changes at this beat
  punchIn: boolean;
}

const MIN_SPLIT_RUN_SEC = 2.5;
const MIN_FULL_RUN_SEC = 1.5;
/** Coverage floor: no contiguous run of visual-less beats may span more than this much wall
 * time. 4.0s is long enough that a single deliberate "breather" beat — let the words carry it,
 * no graphic — still reads as intentional pacing, but short enough to catch the multi-beat dead
 * stretches (two, three beats with needsVisual just under 0.5 back to back) that actually made
 * the short go blank for 6-10s at a time on content the classifier wasn't tuned on. A bare
 * per-beat threshold with no floor has no way to notice that beats are compounding into a gap.
 *
 * The classifier is often RIGHT to skip a beat -- "Um, it's still in the making, so" has nothing
 * to visualize, and forcing a card onto it just makes the copy stage manufacture junk. So a run
 * over this budget is resolved in preference order, not by blind promotion:
 *   1. hold.ts's extendOverDeadRuns runs FIRST (before this file even sees the beats) and extends
 *      the preceding visual beat's card across the run where it can -- no new copy, can't fabricate
 *      content.
 *   2. Only a run still over budget after that reaches step 1b below, which promotes the
 *      highest-needsVisual beat in the run -- but only among beats that pass isPromotable (real
 *      content, not filler); see MIN_PROMOTABLE_CONTENT_WORDS.
 *   3. A run with no promotable beat and no more room to extend is left dead. That's the accepted
 *      remainder, not a bug: there is genuinely nothing safe to show. */
export const MAX_DEAD_RUN_SEC = 4.0;

function nextHighestExcluding(probabilities: Record<string, number>, exclude: Set<string>, current: string): string {
  const entries = Object.entries(probabilities).filter(([k]) => !exclude.has(k));
  if (entries.length === 0) return current;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Best template (by probability) whose underChin-ness matches the target layout. */
function bestTemplateForLayout(dec: BeatDecision, layout: "full" | "split"): TemplateId {
  const wantUnderChin = layout === "full";
  const entries = Object.entries(dec.template.probabilities) as [TemplateId, number][];
  const filtered = entries.filter(([id]) => isUnderChin(id) === wantUnderChin);
  filtered.sort((a, b) => b[1] - a[1]);
  if (filtered.length > 0) return filtered[0][0];
  return wantUnderChin ? "big_statement" : "versus";
}

// Coverage-floor remedy #3 (guard on remedy #2, promotion): filler tokens named in the brief, plus
// a small generic English stopword set. Deliberately generic -- no video-specific words -- because
// this is a cheap heuristic meant to catch the obvious case (a beat that's essentially connective
// tissue, e.g. "Um, it's still in the making, so"), not to perfectly classify every borderline
// beat. It will occasionally let a vague-but-word-bearing beat through, or block a terse-but-real
// one; that's an accepted tradeoff for staying deterministic and clip-agnostic. Tune the wordlists
// or MIN_PROMOTABLE_CONTENT_WORDS if real runs show it's miscalibrated.
const FILLER_TOKENS = new Set(["um", "uh", "er", "ah", "so", "and", "like", "you", "know"]);
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on", "at",
  "for", "with", "or", "but", "if", "as", "that", "this", "these", "those", "it", "its", "it's", "i",
  "i'd", "i'm", "i'll", "you're", "he", "she", "we", "we're", "they", "them", "my", "your", "his",
  "her", "our", "their", "do", "does", "did", "don't", "doesn't", "didn't", "have", "has", "had",
  "will", "would", "can", "could", "should", "not", "no", "up", "down", "out", "about", "into",
  "than", "then", "there", "here", "what", "which", "who", "whom", "get", "got", "going", "gonna",
  "just", "really", "very", "well", "okay", "right", "mean",
  // Generic vagueness/hedge vocabulary: these words are common in ANY spoken transcript and carry
  // ~no content on their own -- "a few things we're working on" names nothing. Excluding them (not
  // just raw stopwords) is what keeps a vague-but-word-bearing filler beat from clearing the
  // MIN_PROMOTABLE_CONTENT_WORDS bar on word count alone.
  "thing", "things", "stuff", "few", "lot", "lots", "way", "ways", "bit", "bits", "kind", "kinds",
  "sort", "sorts", "part", "parts", "something", "someone", "somewhere", "anything", "anyone",
  "everything", "everyone",
]);

/** Fewer than this many non-filler, non-stopword words left and a beat is treated as substantively
 * contentless -- never a promotion candidate. "~3" per the brief; kept literal and commented rather
 * than silently retuned, since raising it to special-case one transcript would reintroduce the
 * same clip-specific hardcoding this whole fix is about removing. */
export const MIN_PROMOTABLE_CONTENT_WORDS = 3;

/** Exported so verification/tooling can check "is this beat promotable" with the exact same
 * logic assembleStructure uses internally, instead of a reimplementation that could drift. */
export function contentWordCount(text: string): number {
  const tokens = text.toLowerCase().replace(/[^a-z0-9']+/g, " ").split(" ").filter(Boolean);
  return tokens.filter(t => !FILLER_TOKENS.has(t) && !STOPWORDS.has(t)).length;
}

function isPromotable(wb: Working): boolean {
  return contentWordCount(wb.raw.text) >= MIN_PROMOTABLE_CONTENT_WORDS;
}

/** Same predicate as isPromotable, exposed for a raw beat's text directly (no Working wrapper) —
 * for verification scripts checking a specific beat/run without reconstructing internal state. */
export function isPromotableText(text: string): boolean {
  return contentWordCount(text) >= MIN_PROMOTABLE_CONTENT_WORDS;
}

interface Working {
  raw: RawBeat;
  dec: BeatDecision;
  hasVisual: boolean;
  template: TemplateId | null;
  layout: "full" | "split";
  textEffect: TextEffectId;
  transition: TransitionId;
}

export function assembleStructure(beats: RawBeat[], decisions: Decisions): BeatStructure[] {
  // 1. initial visual + template + layout assignment
  const working: Working[] = beats.map((raw, idx) => {
    const dec = decisions.beats[idx];
    const hasVisual = dec.needsVisual >= 0.5 || idx === 0;
    const template = hasVisual ? dec.template.choice : null;
    const layout: "full" | "split" = template && !isUnderChin(template) ? "split" : "full";
    return { raw, dec, hasVisual, template, layout, textEffect: dec.textEffect.choice, transition: dec.transition.choice };
  });

  // 1b. coverage floor, remedy #2 (fallback): promote beats inside any dead (visual-less) run
  //     still longer than MAX_DEAD_RUN_SEC after hold.ts's extendOverDeadRuns has already had first
  //     crack at closing the gap by extending the preceding card (remedy #1 -- see hold.ts and the
  //     MAX_DEAD_RUN_SEC doc comment above for why extending is preferred: it costs no new copy and
  //     can't fabricate content). Highest dec.needsVisual first among PROMOTABLE beats only (remedy
  //     #3 -- isPromotable/MIN_PROMOTABLE_CONTENT_WORDS above); a run with no promotable beat at all
  //     is left dead rather than forcing a card onto filler. Runs AFTER the initial assignment (1)
  //     and BEFORE layout-run smoothing (2) and variety enforcement (3) so those steps see a
  //     consistent, already-covered world — a promoted beat's template is re-pickable by variety
  //     just like any Jev-chosen one. Template comes from the beat's own probability distribution
  //     via bestTemplateForLayout, never a fixed fallback template (see file doc comment for why
  //     that was the previous bug).
  function deadRuns(): { start: number; end: number; dur: number }[] {
    const out: { start: number; end: number; dur: number }[] = [];
    let i = 0;
    while (i < working.length) {
      if (working[i].hasVisual) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < working.length && !working[j + 1].hasVisual) j++;
      out.push({ start: i, end: j, dur: working[j].raw.end - working[i].raw.start });
      i = j + 1;
    }
    return out;
  }

  // Runs we've already determined have no promotable beat -- skip re-checking them so a stubborn
  // all-filler run can't spin the guard loop without ever being resolved. Keyed by index range,
  // which stays stable across iterations since promoting a beat in a DIFFERENT run never touches
  // this run's boundaries (they're separated by a visual beat by definition).
  const unresolvable = new Set<string>();
  for (let guard = 0; guard < working.length + 5; guard++) {
    const over = deadRuns().find(r => r.dur > MAX_DEAD_RUN_SEC && !unresolvable.has(`${r.start}-${r.end}`));
    if (!over) break;
    let bestIdx = -1;
    for (let i = over.start; i <= over.end; i++) {
      if (!isPromotable(working[i])) continue;
      if (bestIdx === -1 || working[i].dec.needsVisual > working[bestIdx].dec.needsVisual) bestIdx = i;
    }
    if (bestIdx === -1) {
      unresolvable.add(`${over.start}-${over.end}`);
      continue;
    }
    const wb = working[bestIdx];
    wb.hasVisual = true;
    wb.template = bestTemplateForLayout(wb.dec, wb.layout);
  }

  // 2. layout-run smoothing: merge runs shorter than threshold into a neighbour, re-picking
  //    template (by probability) to match the target layout when a beat's current template
  //    doesn't fit it.
  function runs(): { layout: "full" | "split"; start: number; end: number; dur: number }[] {
    const out: { layout: "full" | "split"; start: number; end: number; dur: number }[] = [];
    let i = 0;
    while (i < working.length) {
      let j = i;
      while (j + 1 < working.length && working[j + 1].layout === working[i].layout) j++;
      out.push({ layout: working[i].layout, start: i, end: j, dur: working[j].raw.end - working[i].raw.start });
      i = j + 1;
    }
    return out;
  }

  function flipBeatLayout(idx: number, toLayout: "full" | "split") {
    const wb = working[idx];
    wb.layout = toLayout;
    // Layout is tracked on EVERY beat (visual or not) purely for caption-band placement
    // continuity (geometry.ts's captionY differs between full/split) — a dead beat still needs
    // a layout tag when it's folded into a neighbouring run. Only a beat that ALREADY has a
    // visual (wb.hasVisual was true going in, so wb.template is a real, non-null choice) needs
    // its template re-picked here, because ITS card genuinely doesn't fit the new layout. A dead
    // beat (hasVisual false, template null) trivially "doesn't fit" any layout since it has no
    // template at all -- that must NOT be read as license to manufacture a visual for it. Doing
    // so used to promote beats like "Um actually" (1 content word) to a real template just
    // because a neighbouring run's layout won it by smoothing, which violates the same
    // never-fabricate-a-card-from-nothing rule the coverage-floor guard (isPromotable /
    // MIN_PROMOTABLE_CONTENT_WORDS above) enforces elsewhere in this file.
    if (!wb.hasVisual) return;
    const fitsLayout = wb.template && (isUnderChin(wb.template) === (toLayout === "full"));
    if (!fitsLayout) {
      wb.template = bestTemplateForLayout(wb.dec, toLayout);
      wb.hasVisual = true;
    }
  }

  for (let guard = 0; guard < working.length + 5; guard++) {
    const rs = runs();
    let changed = false;
    for (let r = 0; r < rs.length; r++) {
      const run = rs[r];
      const minDur = run.layout === "split" ? MIN_SPLIT_RUN_SEC : MIN_FULL_RUN_SEC;
      if (run.dur >= minDur) continue;
      if (rs.length === 1) break;
      const prev = rs[r - 1];
      const next = rs[r + 1];
      const target = prev ? prev.layout : next!.layout;
      for (let i = run.start; i <= run.end; i++) flipBeatLayout(i, target);
      changed = true;
      break;
    }
    if (!changed) break;
  }

  // 3. template variety: no two consecutive identical templates -> re-pick via next-highest-probability
  //    (constrained to templates that fit the beat's current layout, so layout stays valid)
  //    The beat LESS sure of the shared template is the one that moves (so a 0.99 pick is never
  //    displaced by a 0.30 neighbour), and the alternative must differ from both neighbours.
  for (let i = 1; i < working.length; i++) {
    const cur = working[i];
    const prev = working[i - 1];
    if (cur.template && prev.template && cur.template === prev.template) {
      const tpl = cur.template;
      const pOf = (w: Working) => w.dec.template.probabilities[tpl] ?? 0;
      const moveIdx = pOf(prev) < pOf(cur) ? i - 1 : i;
      const mover = working[moveIdx];
      const wantUnderChin = mover.layout === "full";
      const filteredProbs: Record<string, number> = {};
      for (const [id, p] of Object.entries(mover.dec.template.probabilities)) {
        if (isUnderChin(id as TemplateId) === wantUnderChin) filteredProbs[id] = p;
      }
      const exclude = new Set<string>([tpl]);
      const before = working[moveIdx - 1]?.template;
      const after = working[moveIdx + 1]?.template;
      if (before) exclude.add(before);
      if (after) exclude.add(after);
      mover.template = nextHighestExcluding(filteredProbs, exclude, tpl) as TemplateId;
      mover.hasVisual = true;
    }
  }

  // 4. textEffect / transition variety: no run of 3+ identical -> re-pick via next-highest-probability
  function enforceStreak(get: (w: Working) => string, set: (w: Working, v: string) => void, probsOf: (w: Working) => Record<string, number>) {
    let streakVal: string | null = null;
    let streakLen = 0;
    for (const wb of working) {
      const v = get(wb);
      if (v === streakVal) streakLen++;
      else {
        streakVal = v;
        streakLen = 1;
      }
      if (streakLen >= 3) {
        const alt = nextHighestExcluding(probsOf(wb), new Set([v]), v);
        set(wb, alt);
        streakVal = alt;
        streakLen = 1;
      }
    }
  }
  enforceStreak(
    wb => wb.textEffect,
    (wb, v) => (wb.textEffect = v as TextEffectId),
    wb => wb.dec.textEffect.probabilities,
  );
  enforceStreak(
    wb => wb.transition,
    (wb, v) => (wb.transition = v as TransitionId),
    wb => wb.dec.transition.probabilities,
  );

  // 5. transitionIn: hard_cut unless layout or template changes at this beat
  const transitionIn: TransitionId[] = working.map((wb, i) => {
    if (i === 0) return "hard_cut";
    const prev = working[i - 1];
    const changed = wb.layout !== prev.layout || wb.template !== prev.template;
    return changed ? wb.transition : "hard_cut";
  });

  // 6. punchIn: only on full beats, noul>=0.6, never two consecutive
  const punchIn: boolean[] = working.map(() => false);
  let lastPunch = -2;
  working.forEach((wb, i) => {
    if (wb.layout === "full" && wb.dec.punchIn >= 0.6 && i - lastPunch > 1) {
      punchIn[i] = true;
      lastPunch = i;
    }
  });

  return working.map((wb, i) => ({
    beatId: wb.raw.id,
    hasVisual: wb.hasVisual,
    template: wb.template,
    layout: wb.layout,
    textEffect: wb.textEffect,
    transition: wb.transition,
    transitionIn: transitionIn[i],
    punchIn: punchIn[i],
  }));
}
