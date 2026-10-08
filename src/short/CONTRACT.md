# `short/` — Jev-driven short-form auto-edit (design contract)

Goal: talking-head clip (<60s) in → polished 1080x1920 short out, **end-to-end in under 60s
wall clock**, with Jev (classifier) making every editing decision from big option menus.

```
npx tsx src/short/auto.ts --in <src.mp4> --out <out.mp4> [--work <dir>]
```

Pipeline (stage → owner file → artifact in work dir):

| # | Stage | File | Artifact |
|---|---|---|---|
| 1 | transcribe (parakeet-mlx, verbatim) ‖ perceive (frames, Apple Vision faces, 1 vision-LLM scene description) | `transcribe.ts`, `perceive.ts`, `perceive/faces.swift` | `words.json`, `perception.json` |
| 2 | Jev fan-out: 1 global request + 1 request per beat, all questions for a beat in ONE request | `menus.ts`, `decide.ts` | `decisions.json` |
| 2b | hold: adjacent beats where Jev picked the SAME template merge into one held card (≤9s) | `hold.ts` | — |
| 3 | structure (deterministic: layout smoothing, confidence-aware variety re-picks, transitions, camera) — BEFORE copy, so copy is only written for the template a beat really uses | `structure.ts` | — |
| 4 | ONE batched fast-LLM call (Groq) fills template fields + fixes ASR proper nouns | `copy.ts` | `copy.json` |
| 4b | finalize: validate copy, geometry from face box, emphasis, sfx, `fields.revealAt` (answer lands when the speaker says it) | `finalize.ts`, `geometry.ts` | `plan.json` |
| 5 | build ONE self-contained transparent 1080x1920 page for the whole video | `film/buildFilm.ts` | `film.html` |
| 6 | capture page frames in N parallel sidecar workers (time-chunked) → PNG sequence | `render.ts` | `frames/%05d.png` |
| 7 | ONE ffmpeg pass: speaker layout segments + film overlay + sfx → h264_videotoolbox | `render.ts` | out.mp4 |

Rules: TypeScript run with `npx tsx` from the repo root. No new runtime deps, no Playwright,
no network at render time, system fonts only. Never print/log/commit API keys
(`TYPESAFE_API_KEY` and `GROQ_API_KEY` come from the shell or the repo-root `.env`, via `../env.ts`).
Shared helpers: `../jevClient.ts`, `../render/sidecar.ts`, `../render/seekScript.ts`, `../render/sfx.ts`, `../render/ffutil.ts`.
ffmpeg 9 quirks: `-fps_mode` not `-vsync`; no libass; `h264_videotoolbox` available.

## Geometry (output 1080x1920, 30fps)

Two speaker layouts, hard-switched in ffmpeg; the film page draws everything else.

- `split`: source cropped by `geometry.split.crop` (square, 1.12x zoom on the face, anchored on the estimated top of the head with ~36px of headroom below the panel edge) then scaled to 1080x1080 at y=840..1920. Panel = y 0..840 (page paints it opaque).
  Panel content box: x 60..1020, y 150..790 (top 150 is platform UI). The core builds each card at a few
  virtual widths and scale-fits the settled card to this box (`measureFit` in `film/core.js`), so templates
  may be authored at modest px sizes.
- `full`: source cropped to 9:16 around the face (crop width = srcH*9/16, centered on face cx, clamped),
  scaled to 1080x1920. Page is transparent here except captions and "under-chin" visuals.
- Platform safe area: keep all text inside x 60..960, y 150..1580.
- `plan.geometry` (computed in assemble from the median face box, consumed by film AND render):
  `{ full:{crop:{x,y,w,h}, face:{x,y,w,h}, captionY, visualRect:{x,y,w,h}}, split:{speaker:{x,y,w,h}, panel:{x,y,w,h}, face:{...}, captionY} }`
  — `face` is in OUTPUT px for that layout, already padded 12%. **Nothing may be drawn intersecting `face`.**
  `captionY` = center of the caption band, placed below the chin (face bottom + margin), never above 1580.
- `punchIn` on a beat is legacy and only kept for plans without `plan.shots`.
- Camera: `plan.shots` is the fine-grained layer (a shot is about 2 to 3 s, cut by `shots.ts` at natural
  pauses). Each shot carries a `camera`: `base`, `punch` (1.12 hard cut), `face_closeup` (1.22), `push_in`
  (slow zoom in) or `drift` (slow pan). `framing.ts` `moveRect` is the single definition of the moving
  crop; render.ts feeds it to ffmpeg (`scale eval=frame` plus `crop` on shot-local time) and preview.ts
  embeds the same function, so both show the same framing. The face stays inside the crop. A `split`
  shot never animates.
- Rhythm: `rhythm.ts` runs after Jev answers and enforces a visible change at least every 3 s, no
  repeated camera, a card density cap, at most one giant word per 8 to 10 s (and a floor on long clips)
  and a clean hook window. Every override is logged in `plan.rhythm.overrides` with the rule name and
  the before/after value; `shot.jev` keeps what Jev picked.
- Giant words: `overlay: "giant_word"` draws one word huge BEHIND the speaker. `matte.ts` cuts the person
  out (Apple Vision) for each giant window and the hook window; the cut-out frames live in `fg/` and
  `plan.giants` lists them. The hook and giants use the vendored 24fps engine layer (`film/hook24.js`).
- Caption sections: `plan.captionSections` lets the caption style change at section boundaries (all 8
  styles are on the menu). `FilmCaptions.styleAt(plan, t)` picks the style; engine styles
  (`anton_karaoke`, `archivo_chip`, `inter_editorial`) are mounted by `hook24.js`.
- Text safety: after the page is built, `core.js` measures every card's text at 75% of its hold and
  shrinks any text that overflows its box. The renderer prints `text overflow fixed` or
  `text overflow NOT FIXED` for each case (`window.__filmOverflow`).

## plan.json

```ts
interface ShortPlan {
  source: { path: string; durationSec: number; width: number; height: number; fps: number };
  output: { width: 1080; height: 1920; fps: 30 };
  perception: { face: {x:number;y:number;w:number;h:number} /* normalized 0..1, source, median */;
                facePerSecond: ({x,y,w,h}|null)[]; description: string };
  geometry: Geometry;                       // see above
  style: { family: StyleFamilyId; accent: AccentId; captionStyle: CaptionStyleId; energy: number /*0 calm..2 hype*/; progressBar: boolean };
  words: { i: number; text: string; start: number; end: number; emph?: boolean }[]; // text already ASR-corrected
  beats: Beat[];                            // contiguous, cover 0..duration
  sfx: { type: "whoosh"|"pop"|"ding"|"riser"|"impact"; at: number; gainDb: number }[];
  cuts?: number[];                          // clean stage only: OUTPUT-time seconds of each visible cut
  loudness?: LoudnormMeasure;               // clean stage only: loudnorm pass-1 numbers for the final render
  clean?: CleanStats;                       // clean stage only: before/after duration, seconds per reason
  timings?: Record<string, number>;         // ms per stage, filled by auto.ts
}
interface Beat {
  id: string; start: number; end: number; text: string; wordRange: [number, number]; // inclusive word idx
  layout: "full" | "split";
  visual: null | { template: TemplateId; fields: Record<string, unknown>; textEffect: TextEffectId; confidence: number };
  transitionIn: TransitionId;               // effect drawn by the page centered on beat.start (only meaningful when layout/visual changes)
  punchIn: boolean;                         // legacy; plan.shots[].camera supersedes it
}
// additive: shots?: ShotPlan[] (camera, overlay, textEffect, transitionIn, caption, jev picks),
// giants?: GiantPlan[], rhythm?: RhythmReport, captionSections?: {start,end,style}[]
```
In `full` layout only templates flagged `underChin: true` may appear (drawn inside `geometry.full.visualRect`);
any other template forces `split`. After the clean stage, `plan.source.path` is `work/clean.mp4`, so
output time still equals source time for every stage after it (see "Clean stage").

## Clean stage (`clean/`)

Runs first in `planShort`, unless `--no-clean`. Input is the raw clip; the raw clip is transcribed once,
with precise word ends, and never looked at again after this stage.

1. `retakes.ts` finds candidate retakes (a sentence or phrase said again, short adjacent stutters). Jev
   confirms each one (`confirm.ts`, one noul question per candidate, cut at `JEV_CUT_THRESHOLD` 0.5). The
   LAST take is kept; for a 2 to 4 word stutter the second occurrence is kept. If Jev is unavailable the
   deterministic candidates with at least `FALLBACK_MIN_MATCH` matching words are cut instead, with a warning.
   `takes.ts` then adds a take-selection pass: Groq (`GROQ_TEXT_MODEL`, temperature 0, JSON) reads the whole raw
   transcript packed one line per phrase (a pause of `TAKES_PHRASE_GAP_SEC` 0.5 s starts a new line, each word
   carries its index, prompt in `takesPrompt.ts`) and proposes word ranges to drop. The model can only name word
   indices; `guardProposals` refuses a range that is not whole words, any drop longer than a slip whose content
   is not said again later (so the last take of a line is never dropped), a short drop inside a phrase with no
   repeat after it, and anything that would take the model's own total past `TAKES_MAX_DROP_FRACTION` (25%) of
   the speech. Jev's retakes are kept as they are, the model adds what the n-gram pass missed. If the Groq call
   fails or the answer is not JSON, nothing is added and a warning is logged.
2. `recover.ts` guards against speech the transcript lacks. Voiced spans (silencedetect, relative to clip
   loudness) of at least 0.6 s with no words are re-transcribed together in one batched parakeet call (spans padded
   0.3 s, 1 s of silence between them) and the words are merged back with their offsets. A span that is still
   empty and at least 1.2 s long is protected: no cut may touch it, and `clean.json` lists it under `kept` with
   reason `untranscribed_kept`. Shorter empty spans stay eligible for the filler rule.
3. `edges.ts` finds the real sound edges of every word on the 10 ms loudness envelope, ignoring the
   transcript timestamps (parakeet starts early and ends late). Each word has a core, its loudest frame in its own
   cell; the onset and offset walk out from the core to where the level falls `ONSET_REL_DB` / `OFFSET_REL_DB`
   below it (clamped to a floor and ceiling) and stays there for 70 ms, never past a neighbour's core, with a
   valley fallback when speech runs on. `keep.ts` turns removed words, gaps and voiced non-word sounds into KEEP
   ranges from those edges: a cut edge sits `PAD_BEFORE_SEC` (50 ms) before an onset and `PAD_AFTER_SEC` (80 ms)
   after an offset, or `PHRASE_PAD_BEFORE_SEC` / `PHRASE_PAD_AFTER_SEC` (40 / 50 ms) inside a phrase (the
   earlier word has no punctuation). The deliberate breath at a join is gone. A true silence over `maxGap`
   (0.35 s, measured on the audio) still shrinks to the pads. Edges round to the nearest frame but never come
   within `EDGE_MARGIN_SEC` (30 ms) of the sound, so no cut lands inside a word. `snapWordsToEdges` puts the same
   edges on the word list, and `remapWords` keeps a word when its center lies in a keep range.
4. `cut.ts` makes `work/clean.mp4` in one ffmpeg call: trim and atrim per KEEP range, 30 ms audio fades at
   each join, concat, frame-accurate, h264_videotoolbox at a high bitrate and AAC 256k.
5. `remap.ts` moves the surviving words onto the clean clock; `cutPoints` gives `plan.cuts`.
6. `ffmpegTools.ts` measures loudnorm pass 1 on clean.mp4 (after a highpass at 80 Hz). The final render applies
   pass 2 once, on the final mix, with `linear=true` and a -1 dBFS ceiling limiter.

`work/clean.json` lists every cut as `{start, end, reason, text, source, why?, jev?}` with `reason` one of
`retake`, `silence`, `filler`, `lead`, `tail` (times are on the RAW clock) and `source` one of `jev`, `llm`,
`jev+llm` (retakes) or `rule` (everything else); `why` is the model's reason for an LLM retake. A
`takeSelection` block lists every proposal the model made, with its word range, text, reason, whether it was
accepted and, if not, why the guard refused it. Also in the file: the KEEP ranges, every retake
candidate with its score, the `kept` spans (voiced audio without words that was left alone), and the stats. `npm test` covers the pure parts with synthetic word lists.

## Option menus (ids are the contract; descriptions for Jev live in `menus.ts`)

- **StyleFamilyId** (whole video): `apple_glass` frosted translucent cards, SF Pro, soft depth · `bold_kinetic` heavy caps, yellow/green highlights, black stroke · `terminal_type` monospace, cursor, green/amber on near-black · `neon_cyber` dark, glowing magenta/cyan outlines · `paper_editorial` cream paper, serif, ink underline, marker highlight · `clean_swiss` white/black grid, one red accent · `gradient_pop` vivid gradients, chunky rounded, playful · `dark_luxe` black + gold, thin serif, restrained
- **AccentId**: `blue` `green` `yellow` `orange` `red` `pink` `purple` `cyan`
- **CaptionStyleId**: `word_pop` (2–3 words, active word accent + scale) · `single_word` (one huge word) · `karaoke_line` (line shown, words fill as spoken) · `boxed_highlight` (active word on accent box) · `typewriter_line` · engine styles `anton_karaoke` · `archivo_chip` · `inter_editorial`
- **TextEffectId**: `typewriter` `word_pop` `slide_up` `blur_in` `scramble_decode` `highlighter_swipe` `scale_punch` `mask_reveal`
- **TransitionId**: `hard_cut` `flash` `whip_streak` `glass_wipe` `zoom_blur` `glitch_slice`
- **TemplateId** and fields (strings short: ≤5 words unless noted):
  | id | fields | underChin |
  |---|---|---|
  | `big_statement` | `{text, sub?}` | yes |
  | `stamp` | `{text, tone:"negative"\|"positive"}` | yes |
  | `keyword_pill` | `{text, emoji?}` | yes |
  | `stat_number` | `{value, unit?, label}` | yes |
  | `versus` | `{left, right, leftSub?, rightSub?, winner?:"left"\|"right"}` | no |
  | `option_chips` | `{question?, options:string[2..5], pickedIndex, confidencePct?}` | no |
  | `confidence_meter` | `{label, pct}` | no |
  | `yes_no` | `{question, answer:"yes"\|"no", pct}` | no |
  | `scale_slider` | `{question?, labels:string[2..5], value /*0..labels.length-1, float*/, valueLabel?}` | no |
  | `numbered_point` | `{number, title, sub?}` | no |
  | `checklist` | `{title?, items:string[2..4]}` | no |
  | `chat_bubble` | `{from?, message /*≤14 words*/}` | no |
  | `definition` | `{term, meaning /*≤10 words*/}` | no |
  | `icon_row` | `{items:{emoji,label}[2..4]}` | no |
  | `code_terminal` | `{lines:string[1..4]}` | no |
  | `flow_steps` | `{steps:string[2..4]}` | no |
  | `dual_stat` | `{leftValue,leftLabel,rightValue,rightLabel}` | no |
  | `quote` | `{text /*≤14 words*/, by?}` | no |

## Film page API (`film/`)

`film.html` = `film/core.js` + `film/themes.js` + `film/captions.js` + `film/effects.js` + `film/transitions.js`
+ every `film/templates/*.js` + `window.__PLAN = {...}` all inlined by `buildFilm.ts`. Transparent `html,body`.
**Determinism: every pixel is a pure function of `t`. No CSS transitions/animations, no timers, no
Math.random (use seeded hash).** Entry point `window.renderFrame(t)` (seconds); `window.__filmReady = true` when built.

```js
Film.registerTemplate("versus", {
  underChin: false,
  build(root, fields, ctx) {},        // create DOM once inside root (root is sized to ctx.rect, position:relative)
  update(root, lt, dur, ctx) {},      // lt = seconds since beat start, dur = beat length. Own enter (≈0.45s, staggered) + exit (last 0.2s)
});
// ctx = { rect:{w,h}, theme /*resolved tokens object*/, accent /*css color*/, energy, fx: Film.fx, textEffect /*TextEffectId*/ }
// Film.fx = { clamp, lerp, ease:{outCubic,outBack,outExpo,inOutCubic}, prog(lt,start,dur), hash(str|n)->0..1,
//             text(el, string, effectId) -> handle; handle.update(p /*0..1 reveal progress*/) }  // splits into spans, applies the TextEffectId
```
## Visual system (`film/themes.js`)

Theme tokens are CSS custom properties set as **inline styles on `#film`** by `Themes.apply(root, familyId, accentId)`.
Because they are inline, a `#film[data-family='x']{--token:…}` stylesheet rule **cannot** override them — change the
family function instead. Scoping a token to a *descendant* (e.g. `.fcard{--text:…}`) does work, and is the supported
way to give one family two ink polarities (see `gradient_pop`).

Templates style **only** through these tokens and the shared classes. Never hardcode a hex.

### Tokens every family must define

| group | tokens |
|---|---|
| surface | `--panel-bg --card-bg --card-border --card-border-width --card-radius --card-shadow --card-blur` |
| ink | `--text --text-dim --rule --positive --negative` |
| type | `--font-display --font-body --font-mono --font-num --display-weight --display-case --display-tracking --label-tracking --num-weight --num-tracking --text-stroke` |
| scale | `--t-hero --t-title --t-body --t-label --t-meta` |
| shape | `--kick-radius --slab-radius --chip-radius --bar-radius --frame-radius --ghost-alpha --stage-pad` |
| chip | `--chip-bg --chip-shadow` |
| frame | `--frame-border --frame-inset --frame-color --frame-shadow` |
| meta | `--meta-rule --meta-rule-w` |
| captions | `--cap-fg --cap-dim --cap-stroke --cap-weight --cap-weight-mono --cap-pill-radius` (all optional; `captions.js` has white/900/3px defaults) |

Derived **per accent** by the core, families must not redefine them:
`--accent --accent-2 --accent-ink --accent-grad --accent-grad-v --accent-glow --accent-soft --accent-faint`
plus `--meter-track --meter-inset --is-light`, which follow the **panel's** light/dark polarity.

### Shared classes

`.fcard` `.fcard-lit` `.fchip` `.fchip-on` `.flabel` `.fhero` `.fnum` `.fnum-accent` `.fmeter` `.fmeter-fill`
`.fstage` `.fghost` `.fkicker` `.ftick` `.frule` `.fbar` `.fmeta` (`.fmeta-top`) `.fkick` (`.fkick-accent`)
`.fslab` `.fframe` `.fnotch` `.fmark` (`-sq` `-dot` `-ring`).

`.fstage` is authored at **940:550**, the aspect that fills the 960×640 panel content box on both axes at once.
`.fkicker` sets no font-size — kicker text must carry `.flabel`.

### Performance rules (frame capture is a selling point)

Budget: **`frames` ≲ 16s for 1517 frames on 6 workers.** Current measured state is **29.2s**, and the honest floor
with the panel backdrop stubbed out entirely (cards + captions still present) is **22.1s** — so 16s is not reachable
while the panel has any art at all. Treat 16s as a direction, not a gate, and spend the budget where it shows.

**The cost model, measured one property at a time on the 1517-frame test clip. Do not re-derive it by guessing.**

- **Painting less into a layer saves nothing.** Quantising the backdrop canvas to 12 repaints/sec and early-returning
  (skipping ~80% of paints) moved `frames` 34.155s → 34.704s, i.e. inside the noise. Frames are screenshots: the cost
  is compositing the layers that exist, not the drawing calls that fill them. **Optimise by removing layers and
  effects, never by drawing less into them.**
- **Blurred shadows are the dominant card-layer cost, and the cost scales with blur radius, not with motion.**
  From a 34.2s baseline: `box-shadow:none` on `.fcard`/`.fcard-lit` alone → 28.5s (**−5.7s**). All shadow/filter/
  text-shadow off → 25.8s (**−8.4s**), split box-shadow 6.6s / text-shadow 2.5s / filter 1.1s.
  **Shadow budget per family: at most two blurred outer shadows on a card, none over ~64px blur.**
- **Zero-blur inset hairlines are free** — an ordinary edge paint with no blur pass. Anything that should read as an
  *inner glow* belongs in `--card-bg` as an extra gradient layer, where it costs nothing.
- **Backdrop mechanism, four measured against a 22.1s no-backdrop baseline:** CSS radial-gradient stack on the panel
  element 31.8s (+9.7s, worst) · single full-res `<canvas>` child **29.2s (+7.1s, CHOSEN)** · same canvas at half
  resolution CSS-upscaled 30.4s (+8.3s — upscaling every screenshot costs more than the pixels it saves) · one baked
  PNG data-URL as the panel's `background-image` drifting via `background-position` 25.8s (+3.7s, cheapest,
  **rejected on design**: a single bitmap can only pan as a whole, losing per-blob aurora parallax and the
  `terminal_type` scanline / `dark_luxe` sheen sweeps). The rationale is written into `themes.js` above the canvas —
  re-measure before overturning it.
- **No `backdrop-filter`.** The old glass family cost ~2x (24.9s vs 13s). Fake glass with layered gradients,
  inner highlights and borders.
- **No large-radius live `filter: blur()` on a big or animating layer.** A static pre-blurred blob that only
  *translates* is fine.
- `filter: drop-shadow()` is acceptable on a **small static** element (it is the only way to halo text that uses
  `-webkit-background-clip:text`). Never on a stage-sized layer.
- **`feTurbulence` grain must be rendered once** into a data URL and reused, never re-seeded per frame.
- Be deliberate with large box-shadows: one glow on a wrapper, not one per cell (the 30-cell readout in
  `confidence_meter` carries a single wrapper glow).
- Decorative full-panel backgrounds live in the **panel background layer in `core.js`**, never inside the measured
  card subtree.

### Layout traps (each one cost a real debugging session)

1. **`fitText` on a detached subtree silently returns `max`.** An element not yet in the document reports
   `scrollWidth === 0 && scrollHeight === 0`, so the shrink loop never runs. **Always `appendChild` before
   measuring.** This produced the clipped "CHATGP" in `versus`: 484px of text in a 348px card at the untouched
   `max` of 96px.
2. **`fitText` on a flex item is blockified *and stretched*.** `scrollWidth` can never report less than
   `clientWidth`, so any `maxW` below the container width is unsatisfiable and the loop walks straight to `min`.
   Fix with `align-self:flex-start` *before* the call, or pass `maxW ≥` container width and let `maxH` do the work,
   or use `wrap:false` (nowrap makes `scrollWidth` report the true text width).
3. **A wrapped headline grows `.fstage` past its aspect**, `measureFit` divides by the taller box, and the *whole
   card* shrinks. Keeping a short headline on one line is a layout constraint, not a preference.
4. **`fx.text` renders ~14% wider than `fitText` measured.** It rebuilds the string as atomic inline-block glyph
   boxes, and CSS `letter-spacing` is not applied *between* inline boxes, so negative tracking stops applying.
   Re-measure once after the split — at build time only.
5. **`.fnum-accent` is invisible on anything passed through `fx.text`**: `-webkit-background-clip:text` does not
   clip through the child spans.
6. **Inherited family `text-shadow` kills `background-clip:text`.** Fixed centrally by `.fnum-accent{text-shadow:none}`.
7. **Nested gradient values are invalid CSS.** `--accent-grad` is a complete gradient *value*;
   `linear-gradient(var(--accent-grad-v), var(--accent))` silently invalidates the whole declaration.
8. **A positioned `z-index:0` ornament paints above non-positioned text** (paint step 8 vs step 5). Give the text
   `position:relative;z-index:1`. Same reason `.fcard` carries no decorative pseudo-elements.
9. **`measureFit` unions every descendant's `getBoundingClientRect()` and `overflow:hidden` does NOT help** — a
   clipped child still reports its full rect. Absolutely-positioned ornaments must stay fully inside the stage box.
   `opacity:0` elements are skipped; box-shadows and backgrounds do not affect the rect, so glow bleed is free.
10. **An inline `color` on a child beats a family's `.fslab`/`.fcard` class override.** `confidence_meter` hardcoded
    `color:var(--accent-ink)`, which rendered near-black on `dark_luxe`'s *outlined* (background:none) slab. Use
    `color:inherit` and let the family's rule decide.
