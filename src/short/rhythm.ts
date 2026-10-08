/**
 * Rhythm guardrails: deterministic code that runs after Jev has answered and keeps the short
 * moving. Jev picks, per shot, a camera treatment and an overlay (nothing, a card, a keyword pill
 * or a giant word behind the head). This file then enforces what a classifier cannot count:
 *
 *   - the opening hook stays clean: no card, no giant word, calm camera there;
 *   - at most one behind-the-head giant word every GIANT_MIN_GAP_SEC, never right after the hook;
 *   - a card density cap, so the speaker's face stays the main subject;
 *   - the same camera never plays on two shots in a row;
 *   - cards sit under the chin, so wide camera moves are not allowed while one is up;
 *   - something visible changes at least every MAX_CHANGE_GAP_SEC (checked and reported).
 *
 * Every time a guardrail changes Jev's pick it writes a line in the override log, which ends up
 * on the shot in plan.json. Pure functions of their inputs, so the plan stays deterministic given
 * Jev's answers.
 */
import type { Beat, BeatDecision, CameraId, CaptionStyleId, OverlayId, RawBeat, RhythmReport, ShotPlan, TransitionId, Word } from "./types";

export const GIANT_MIN_GAP_SEC = 8.5;
export const GIANT_AFTER_HOOK_SEC = 1.5;
/** Largest share of the speaking time that may carry a card or pill. */
export const CARD_COVERAGE_CAP = 0.55;
export const MAX_CHANGE_GAP_SEC = 3.05;
/** Shortest gap between two transition effects at shot boundaries. */
export const TRANSITION_MIN_GAP_SEC = 5;
export const CAMERAS: CameraId[] = ["base", "punch", "face_closeup", "push_in", "drift"];
/** An animated camera counts as a change this often while it moves. */
const ANIMATED_EVENT_EVERY_SEC = 1.5;

export interface OverrideEntry {
  shotId: string;
  rule: string;
  from: string;
  to: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function overlayOf(dec: BeatDecision): OverlayId {
  if (dec.overlay) return dec.overlay.choice;
  return dec.needsVisual >= 0.5 ? "card" : "none";
}

export function cameraOf(dec: BeatDecision): CameraId {
  return dec.camera?.choice ?? "base";
}

const sumGraphic = (dec: BeatDecision) => (dec.overlay ? (dec.overlay.probabilities.card ?? 0) + (dec.overlay.probabilities.keyword_pill ?? 0) : dec.needsVisual);

/** Best overlay by probability that is not in `exclude`; "none" when nothing is left. */
function nextOverlay(dec: BeatDecision, exclude: Set<string>): OverlayId {
  const entries = Object.entries(dec.overlay?.probabilities ?? { none: 1 }).filter(([k]) => !exclude.has(k));
  entries.sort((a, b) => b[1] - a[1]);
  return (entries[0]?.[0] as OverlayId | undefined) ?? "none";
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * The word for a giant title behind the head: Jev's emphasis pick when it is a plain word of 3 to
 * 12 letters, else the longest plain content word of the shot. null when the shot has none.
 */
export function giantWordFor(shot: RawBeat, dec: BeatDecision, words: Word[]): string | null {
  const plain = (text: string) => {
    const t = text.replace(/[^\p{L}]/gu, "");
    return t.length >= 3 && t.length <= 12 && /^\p{L}+$/u.test(t) ? t.toUpperCase() : null;
  };
  const stop = new Set(["the", "and", "but", "that", "this", "with", "have", "from", "you", "your", "are", "was", "for", "not", "can", "will", "just", "its", "they", "them", "then", "than", "when", "what", "were", "been"]);
  const em = dec.emphasis?.choice;
  if (em && /^w\d+$/.test(em)) {
    const wi = Number(em.slice(1));
    if (wi >= shot.wordRange[0] && wi <= shot.wordRange[1] && words[wi] && !stop.has(norm(words[wi].text))) {
      const p = plain(words[wi].text);
      if (p) return p;
    }
  }
  let best: string | null = null;
  for (let i = shot.wordRange[0]; i <= shot.wordRange[1]; i++) {
    const w = words[i];
    if (!w || stop.has(norm(w.text))) continue;
    const p = plain(w.text);
    if (p && p.length >= 4 && (!best || p.length > best.length)) best = p;
  }
  return best;
}

export interface OverlayPlan {
  /** Per-shot decisions with needsVisual set from the final overlay (copies; the input is untouched). */
  decisions: BeatDecision[];
  /** Final overlay per shot id. */
  overlays: Record<string, OverlayId>;
  /** shot id -> giant word, for the shots that keep a giant word. */
  giants: Record<string, string>;
  log: OverrideEntry[];
}

/**
 * Pre-structure pass over Jev's overlay answers (one per shot): keeps the hook clean, spaces the
 * giant words, and enforces the card density cap. `hookEnd` is 0 when there is no hook.
 */
export function planOverlays(shots: RawBeat[], decs: BeatDecision[], words: Word[], hookEnd: number, totalSec: number, opts: { coverageCap?: number; maxDeadSec?: number; allowGiants?: boolean } = {}): OverlayPlan {
  const cap = opts.coverageCap ?? CARD_COVERAGE_CAP;
  const maxDead = opts.maxDeadSec ?? 6;
  const log: OverrideEntry[] = [];
  const final: OverlayId[] = decs.map(overlayOf);
  const giants: Record<string, string> = {};
  const note = (i: number, rule: string, to: OverlayId) => {
    log.push({ shotId: shots[i].id, rule, from: final[i], to });
    final[i] = to;
  };

  // 1. the hook window stands alone: hook title + captions, nothing else
  const inHook = (i: number) => hookEnd > 0 && shots[i].start < hookEnd - 0.2;
  shots.forEach((_, i) => {
    if (inHook(i) && final[i] !== "none") note(i, "hook window stays clean", "none");
  });

  // 2. giant words: best-supported first, spaced, never right after the hook, and they need a word
  const keptStarts: number[] = [];
  const candidates = shots
    .map((s, i) => ({ i, p: decs[i].overlay?.probabilities.giant_word ?? 0 }))
    .filter(c => final[c.i] === "giant_word")
    .sort((a, b) => b.p - a.p || a.i - b.i);
  for (const c of candidates) {
    const s = shots[c.i];
    const exclude = new Set<string>(["giant_word"]);
    let reason: string | null = null;
    if (opts.allowGiants === false) reason = "no reliable face for a cut-out";
    else if (s.start < hookEnd + GIANT_AFTER_HOOK_SEC) reason = "giant word too close to the hook";
    else if (keptStarts.some(k => Math.abs(k - s.start) < GIANT_MIN_GAP_SEC)) reason = `giant words at least ${GIANT_MIN_GAP_SEC} s apart`;
    const word = reason ? null : giantWordFor(s, decs[c.i], words);
    if (!reason && !word) reason = "no plain word of 3 to 12 letters in this shot";
    if (reason) {
      note(c.i, reason, nextOverlay(decs[c.i], exclude));
    } else {
      keptStarts.push(s.start);
      giants[s.id] = word!;
    }
  }

  // 3. card density: drop the least wanted cards until the face has room, without opening a long dead run
  const isCard = (i: number) => final[i] === "card" || final[i] === "keyword_pill";
  const coverage = () => {
    let sec = 0;
    shots.forEach((s, i) => {
      if (isCard(i)) sec += s.end - s.start;
    });
    return sec / Math.max(1, totalSec - hookEnd);
  };
  const deadRunWith = (drop: number) => {
    // longest stretch around `drop` with no card and no giant if `drop` loses its card
    const covered = (i: number) => (i === drop ? false : isCard(i) || final[i] === "giant_word");
    let a = drop;
    while (a > 0 && !covered(a - 1)) a--;
    let b = drop;
    while (b + 1 < shots.length && !covered(b + 1)) b++;
    return shots[b].end - shots[a].start;
  };
  for (let guard = 0; guard < shots.length && coverage() > cap; guard++) {
    const droppable = shots
      .map((_, i) => i)
      .filter(i => isCard(i) && deadRunWith(i) <= maxDead)
      .sort((a, b) => sumGraphic(decs[a]) - sumGraphic(decs[b]) || a - b);
    if (droppable.length === 0) break;
    const i = droppable[0];
    note(i, `card density cap (${Math.round(cap * 100)}% of the speaking time)`, "none");
  }

  // 4. needsVisual follows the final overlay so structure.ts and hold.ts agree with it
  const decisions = decs.map((d, i) => {
    const g = sumGraphic(d);
    const needs = isCard(i) ? Math.max(g, 0.55) : Math.min(g, 0.45);
    let template = d.template;
    if (final[i] === "keyword_pill" && template.choice !== "keyword_pill") template = { ...template, choice: "keyword_pill" };
    else if (final[i] === "card" && template.choice === "keyword_pill") {
      const alt = Object.entries(template.probabilities)
        .filter(([k]) => k !== "keyword_pill")
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      template = { ...template, choice: (alt ?? "big_statement") as typeof template.choice };
    }
    return { ...d, needsVisual: clamp01(needs), template };
  });
  const overlays: Record<string, OverlayId> = {};
  shots.forEach((s, i) => (overlays[s.id] = final[i]));
  return { decisions, overlays, giants, log };
}

// ---- cameras ----

export interface ShotContext {
  id: string;
  start: number;
  end: number;
  layout: "full" | "split";
  /** A card or pill is on screen for most of this shot (full layout: under the chin). */
  card: boolean;
  /** A behind-the-head giant word is on this shot. */
  giant: boolean;
  /** Inside the opening hook window. */
  hook: boolean;
}

/** Which cameras a shot may use, with the reason a camera was ruled out. */
export function allowedCameras(c: ShotContext): { allowed: CameraId[]; reason: string } {
  if (c.hook) return { allowed: ["base"], reason: "hook window stays clean" };
  if (c.layout === "split") return { allowed: ["base"], reason: "split layout keeps the speaker still" };
  if (c.card) return { allowed: ["base", "punch"], reason: "a card sits under the chin, wide moves would cover it" };
  if (c.giant) return { allowed: ["base", "punch", "face_closeup"], reason: "a moving camera would slide the giant word off the head" };
  return { allowed: CAMERAS.slice(), reason: "" };
}

export interface CameraPlan {
  cameras: CameraId[];
  log: OverrideEntry[];
}

/**
 * Picks the final camera for every shot, in order. Jev's probabilities rank the allowed cameras;
 * the one on the previous shot is excluded (so the picture always changes), and a camera used in
 * the last two shots is down-weighted so the same trick does not come back every other shot.
 */
export function planCameras(ctxs: ShotContext[], decs: BeatDecision[]): CameraPlan {
  const log: OverrideEntry[] = [];
  const cameras: CameraId[] = [];
  ctxs.forEach((c, i) => {
    const dec = decs[i];
    const jev = cameraOf(dec);
    const probs = dec.camera?.probabilities ?? { base: 1 };
    const { allowed, reason } = allowedCameras(c);
    const prev = cameras[i - 1];
    const prevCtx = ctxs[i - 1];
    // the "not twice in a row" rule only binds where the camera can actually move; a run of split
    // shots all hold the speaker still and change through their cards instead
    const mustDiffer = prev !== undefined && allowed.length > 1 && !(prevCtx && prevCtx.layout === "split");
    const recent = cameras.slice(-2);
    const score = (cam: CameraId) => {
      let p = probs[cam] ?? 0;
      if (mustDiffer && cam === prev) return -1;
      if (recent.includes(cam)) p *= 0.15;
      return p + (cam === "base" ? 0.0001 : 0); // stable tiebreak toward the plain camera
    };
    let pick = allowed[0];
    let best = -Infinity;
    for (const cam of allowed) {
      const sc = score(cam);
      if (sc > best) {
        best = sc;
        pick = cam;
      }
    }
    cameras.push(pick);
    if (pick !== jev) {
      let why: string;
      if (!allowed.includes(jev)) why = reason;
      else if (mustDiffer && jev === prev) why = "same camera as the previous shot";
      else why = "camera used in the last two shots, varied instead";
      log.push({ shotId: c.id, rule: why, from: jev, to: pick });
    }
  });
  return { cameras, log };
}

// ---- change events ----

export interface EventShot {
  start: number;
  end: number;
  layout: "full" | "split";
  camera: CameraId;
  overlay: OverlayId;
  /** Id of the card beat on screen ("" when none), so two different cards count as a change. */
  cardKey: string;
}

export const isAnimatedCamera = (c: CameraId) => c === "push_in" || c === "drift";

/**
 * Times at which something visibly changes: a shot whose camera, layout or overlay differs from the
 * previous one, a new card, the moving cameras (every ANIMATED_EVENT_EVERY_SEC while they move), and
 * every clean cut the clean stage made.
 */
export function changeEvents(shots: EventShot[], cuts: number[] = []): number[] {
  const ev: number[] = [];
  shots.forEach((s, i) => {
    const p = shots[i - 1];
    if (!p || p.camera !== s.camera || p.layout !== s.layout || p.overlay !== s.overlay || p.cardKey !== s.cardKey) ev.push(s.start);
    if (isAnimatedCamera(s.camera)) for (let t = s.start + ANIMATED_EVENT_EVERY_SEC; t < s.end - 0.3; t += ANIMATED_EVENT_EVERY_SEC) ev.push(t);
  });
  const lo = shots[0]?.start ?? 0;
  const hi = shots[shots.length - 1]?.end ?? 0;
  for (const c of cuts) if (c > lo && c < hi) ev.push(c);
  return ev.sort((a, b) => a - b);
}

/** Longest stretch between two change events (the start and end of the video count as events). */
export function maxChangeGap(shots: EventShot[], cuts: number[] = []): { gapSec: number; at: number } {
  if (shots.length === 0) return { gapSec: 0, at: 0 };
  const pts = [shots[0].start, ...changeEvents(shots, cuts), shots[shots.length - 1].end];
  let gapSec = 0;
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] - pts[i - 1] > gapSec) {
      gapSec = pts[i] - pts[i - 1];
      at = pts[i - 1];
    }
  }
  return { gapSec, at };
}

// ---- shot-boundary transitions ----

/**
 * Transition into each shot. The first shot of a beat carries the beat's own transitionIn (chosen
 * by structure.ts). The other shots use Jev's per-shot transition pick, but only where the camera
 * changes, not within 0.4 s of a clean cut, and not sooner than TRANSITION_MIN_GAP_SEC after the
 * previous effect, so a short never turns into a wall of flashes.
 */
export function planShotTransitions(
  shots: { id: string; start: number; firstOfBeat: boolean; beatTransition: TransitionId; cameraChanged: boolean }[],
  decs: BeatDecision[],
  cuts: number[],
): { transitions: TransitionId[]; log: OverrideEntry[] } {
  const log: OverrideEntry[] = [];
  let lastFx = -Infinity;
  const transitions = shots.map((s, i) => {
    let want: TransitionId = s.firstOfBeat ? s.beatTransition : decs[i].transition.confidence >= 0.4 && s.cameraChanged ? decs[i].transition.choice : "hard_cut";
    if (want !== "hard_cut") {
      const nearCut = cuts.some(c => Math.abs(c - s.start) < 0.4);
      let why = "";
      if (nearCut) why = "a clean cut is already here";
      else if (s.start - lastFx < TRANSITION_MIN_GAP_SEC) why = `transition effects at least ${TRANSITION_MIN_GAP_SEC} s apart`;
      if (why) {
        log.push({ shotId: s.id, rule: why, from: want, to: "hard_cut" });
        want = "hard_cut";
      } else lastFx = s.start;
    }
    return want;
  });
  return { transitions, log };
}

/** Folds override logs into the shot list (by shot id), in the order the entries fired. */
export function attachOverrides(shots: ShotPlan[], ...logs: OverrideEntry[][]): void {
  const byId = new Map(shots.map(s => [s.id, s]));
  for (const l of logs)
    for (const e of l) byId.get(e.shotId)?.overrides.push(`${e.rule}: ${e.from} -> ${e.to}`);
}

// ---- assembling the final shot list ----

export interface ShotAssemblyInput {
  /** splitShots output: the raw 2 to 3 second shots, 1:1 with `decs`. */
  shots: RawBeat[];
  /** Per-shot decisions after planOverlays. */
  decs: BeatDecision[];
  /** The final plan beats (snapped to frames, layouts and templates decided). */
  beats: Beat[];
  /** planOverlays result. */
  overlay: OverlayPlan;
  /** Length of the opening hook window in seconds; 0 when there is no hook. */
  hookEnd: number;
  /** Clean-stage cut points (seconds); each one is already a visible change. */
  cuts: number[];
  /** Caption style sections; the first one also covers anything before it. */
  captionSections: { start: number; end: number; style: CaptionStyleId }[];
  fps?: number;
}

const snapTo = (t: number, fps: number) => Math.round(t * fps) / fps;

export function assembleShots(input: ShotAssemblyInput): { shots: ShotPlan[]; rhythm: RhythmReport } {
  const { shots: raw, decs, beats, overlay, hookEnd, cuts, captionSections } = input;
  const fps = input.fps ?? 30;
  const end = beats[beats.length - 1].end;
  const starts = raw.map(s => snapTo(s.start, fps));
  const eps = 1e-6;
  const beatOf = (t: number): Beat => beats.find(b => t >= b.start - eps && t < b.end - eps) ?? beats[beats.length - 1];

  const log: OverrideEntry[] = [...overlay.log];
  const own: OverrideEntry[] = [];
  const ctxs: ShotContext[] = [];
  const finalOverlay: OverlayId[] = [];
  const giantWord: (string | undefined)[] = [];
  raw.forEach((s, i) => {
    const start = starts[i];
    const beat = beatOf(start);
    const planned = overlay.overlays[s.id];
    const showsCard = !!beat.visual && start >= (beat.visualFrom ?? beat.start) - eps;
    let ov: OverlayId = showsCard ? (beat.visual!.template === "keyword_pill" ? "keyword_pill" : "card") : "none";
    let word: string | undefined = overlay.giants[s.id];
    if (word && beat.layout !== "full") {
      own.push({ shotId: s.id, rule: "giant word needs the full-bleed speaker", from: "giant_word", to: ov });
      word = undefined;
    }
    if (word) ov = "giant_word";
    // structure.ts may have promoted a card onto a shot that Jev left bare (long stretch with nothing)
    if (ov !== "none" && ov !== "giant_word" && planned === "none" && beat.id === s.id) {
      own.push({ shotId: s.id, rule: "nothing on screen for too long, a card was added", from: "none", to: ov });
    }
    finalOverlay.push(ov);
    giantWord.push(word);
    ctxs.push({
      id: s.id,
      start,
      end: i + 1 < raw.length ? starts[i + 1] : end,
      layout: beat.layout,
      card: showsCard,
      giant: !!word,
      hook: hookEnd > 0 && start < hookEnd - 0.2,
    });
  });

  const camPlan = planCameras(ctxs, decs);
  const firstOfBeat = raw.map((_, i) => {
    const b = beatOf(starts[i]);
    return Math.abs(b.start - starts[i]) < eps;
  });
  const trans = planShotTransitions(
    raw.map((s, i) => ({
      id: s.id,
      start: starts[i],
      firstOfBeat: firstOfBeat[i],
      beatTransition: beatOf(starts[i]).transitionIn,
      cameraChanged: i > 0 && camPlan.cameras[i] !== camPlan.cameras[i - 1],
    })),
    decs,
    cuts,
  );

  const captionAt = (t: number): CaptionStyleId => {
    const sec = captionSections.find(c => t >= c.start - eps && t < c.end - eps) ?? captionSections[captionSections.length - 1];
    return sec.style;
  };

  const out: ShotPlan[] = raw.map((s, i) => {
    const beat = beatOf(starts[i]);
    const wr = s.wordRange;
    return {
      id: s.id,
      start: starts[i],
      end: ctxs[i].end,
      text: s.text,
      wordRange: [wr[0], wr[1]],
      beatId: beat.id,
      layout: beat.layout,
      camera: camPlan.cameras[i],
      jev: { camera: cameraOf(decs[i]), overlay: overlayOf(decs[i]) },
      overlay: finalOverlay[i],
      ...(giantWord[i] ? { giantWord: giantWord[i] } : {}),
      transitionIn: trans.transitions[i],
      captionStyle: captionAt(starts[i]),
      overrides: [],
    };
  });
  attachOverrides(out, log, own, camPlan.log, trans.log);

  const events: EventShot[] = out.map(s => ({
    start: s.start,
    end: s.end,
    layout: s.layout,
    camera: s.camera,
    overlay: s.overlay,
    cardKey: s.overlay === "card" || s.overlay === "keyword_pill" ? s.beatId : s.overlay === "giant_word" ? `giant:${s.id}` : "",
  }));
  const gap = maxChangeGap(events, cuts);
  const cardSec = out.reduce((a, s) => a + (s.overlay === "card" || s.overlay === "keyword_pill" ? s.end - s.start : 0), 0);
  const all = [...log, ...own, ...camPlan.log, ...trans.log];
  const rhythm: RhythmReport = {
    maxGapSec: Math.round(gap.gapSec * 100) / 100,
    cardCoverage: Math.round((cardSec / Math.max(1, end - Math.max(0, hookEnd))) * 100) / 100,
    overrides: all,
  };
  return { shots: out, rhythm };
}

/** Caption sections from the per-section answers; falls back to one section with the global style. */
export function captionSectionsFrom(
  sections: { start: number; end: number; captionStyle: { choice: CaptionStyleId } }[] | undefined,
  globalStyle: CaptionStyleId,
  totalSec: number,
): { start: number; end: number; style: CaptionStyleId }[] {
  if (!sections || sections.length === 0) return [{ start: 0, end: totalSec, style: globalStyle }];
  const out = sections.map((s, i) => ({
    start: i === 0 ? 0 : s.start,
    end: i === sections.length - 1 ? Math.max(totalSec, s.end) : s.end,
    style: i === 0 ? globalStyle : s.captionStyle.choice,
  }));
  return out;
}
