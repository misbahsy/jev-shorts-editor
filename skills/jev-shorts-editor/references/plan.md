# plan.md: fixing a short by editing plan.json

`<work>/plan.json` is the whole edit: captions, cards, camera, transitions, hook, giant words, sound effects. The renderer reads it and nothing else. Edit it, re-render with `--plan`, and the video changes. The TypeScript shape is `ShortPlan` in `src/short/types.ts`.

Contents: [Time base](#time-base) / [Re-rendering](#re-rendering) / [Top-level fields](#top-level-fields) / [Recipes](#recipes) / [Rhythm and overrides](#rhythm-and-overrides) / [Things that break the render](#things-that-break-the-render)

## Time base

`words`, `beats`, `shots`, `giants`, `captionSections`, `cuts`, `fx.leaks`, `sfx[].at` and `hook.endSec` are all in OUTPUT time: seconds in the finished short, after the cuts. After the clean stage `source.path` points at `work/clean.mp4`, which is already cut, so output time and source time are the same clock. Never shift times to "make room"; change text in place.

## Re-rendering

Same command as SKILL.md section 4, with `--plan`. It skips transcription, Jev and the copywriter, so no API is called. It rebuilds `film.html` from the plan, renders frames and encodes, which takes about a minute. Add `--no-export` to check only the preview. Always write to a new `--out` name.

Edit with a JSON-aware tool (`jq`, or a small node script), not by hand with sed on long lines. Keep a copy first: `cp plan.json plan.before.json`.

## Top-level fields

| Field | What it does | Edit? |
|---|---|---|
| `source` | Clip path, duration, size, fps. `durationSec` also sets the film length | Leave alone |
| `output` | Fixed 1080x1920 at 30 fps | Leave alone |
| `perception` | Face box and per-second face boxes, used at plan time | Leave alone (informational) |
| `geometry` | Panel, face and card rectangles computed from the face box. Render and film both use it | Leave alone |
| `style` | `family`, `accent`, `captionStyle`, `energy` (0 calm to 2 hype), `progressBar` (bool) | Edit `family`, `accent`, `energy`, `progressBar`. `captionStyle` is ignored when `captionSections` exists, see below |
| `words` | Caption words: `i`, `text`, `start`, `end`, `emph` | Edit `text` and `emph`. Leave `i`, `start`, `end` |
| `beats` | One per card slot: `start`, `end`, `layout`, `visual`, `transitionIn`, `wordRange` | Edit `visual`. Leave times, ids and `wordRange`. Beats must stay contiguous |
| `shots` | 2 to 3 s shots: `layout`, `camera`, `transitionIn`, plus bookkeeping | Edit `camera`, `transitionIn`. Leave times, ids, `beatId`, `wordRange` |
| `captionSections` | `[{start, end, style}]`, the caption style per time range | Edit `style` |
| `giants` | Giant words behind the speaker: `start`, `end`, `preset`, `cutout`, `fgDir`, `fgFrames` | Edit `preset.layers[].text` and `size`, or delete an entry. Leave the rest |
| `hook` | Opening hook text behind the speaker: `endSec`, `preset`, `cutout`, `fgDir`, `fgFrames` | Edit `preset.layers[].text` and `size`. Leave the rest |
| `sfx` | `[{type, at, gainDb}]`, `type` is `whoosh`, `pop`, `ding`, `riser` or `impact` | Edit freely: change `gainDb`, move `at`, delete entries |
| `fx.leaks` | Output times of warm light-leak flashes | Delete entries to remove a flash |
| `cuts` | Output times of the clean stage's cuts. A `base` shot may flip to punch at each | Leave alone |
| `loudness` | Loudness measurement fed to the final audio pass | Leave alone |
| `clean`, `timings` | Stats from earlier stages | Ignore |
| `rhythm`, `shots[].overrides`, `shots[].jev` | Log of what the rhythm rules changed | Read-only, see [Rhythm and overrides](#rhythm-and-overrides) |

Fields the renderer ignores (bookkeeping only, editing them does nothing): `beats[].text`, `shots[].text`, `visual.confidence`, `shots[].overlay`, `shots[].giantWord`, `shots[].captionStyle`, `giants[].word`, `giants[].shotId`, `giants[].presetId`, `hook.word`, `hook.line`, `hook.presetId`. When you change what is drawn, change these to match anyway so the plan stays readable.

## Recipes

### Fix a caption word

Find the word by its `text` (and `start` time to pick the right one) in `words`, set `words[i].text`. Keep one word per entry; do not add or remove entries, because `wordRange` indices point at them. `emph: true` draws the word in the accent colour. Example: `{"i": 14, "text": "Kubernetes", ...}`.

### Change card copy

Edit `beats[].visual.fields`. The keys depend on `visual.template`. Keep strings short (5 words or fewer unless noted) or the text gets shrunk to fit; shrinking is logged in the page's `window.__filmOverflow`.

| template | fields |
|---|---|
| `big_statement` | `{text, sub?}` |
| `stamp` | `{text, tone: "negative" or "positive"}` |
| `keyword_pill` | `{text, emoji?}` |
| `stat_number` | `{value, unit?, label}` |
| `versus` | `{left, right, leftSub?, rightSub?, winner?: "left" or "right"}` |
| `option_chips` | `{question?, options: string[2..5], pickedIndex, confidencePct?, revealAt?}` |
| `confidence_meter` | `{label, pct, revealAt?}` |
| `yes_no` | `{question, answer: "yes" or "no", pct, revealAt?}` |
| `scale_slider` | `{question?, labels: string[2..5], value, valueLabel?, revealAt?}` (`value` is 0 to labels.length-1, may be a fraction) |
| `numbered_point` | `{number, title, sub?}` |
| `checklist` | `{title?, items: string[2..4]}` |
| `chat_bubble` | `{from?, message}` (message 14 words or fewer) |
| `definition` | `{term, meaning}` (meaning 10 words or fewer) |
| `icon_row` | `{items: [{emoji, label}] (2..4)}` |
| `code_terminal` | `{lines: string[1..4]}` |
| `flow_steps` | `{steps: string[2..4]}` |
| `dual_stat` | `{leftValue, leftLabel, rightValue, rightLabel}` |
| `quote` | `{text, by?}` (text 14 words or fewer) |

`revealAt` is seconds into the beat. `visual.textEffect` is one of: typewriter, word_pop, slide_up, blur_in, scramble_decode, highlighter_swipe, scale_punch, mask_reveal. `visual.offset {dx, dy}` nudges the card in output pixels.

Only `big_statement`, `stamp`, `keyword_pill` and `stat_number` are built for `"layout": "full"` beats. Every other template is designed for the split panel and can land on the speaker's face in a full beat. To switch a full beat to one of those, set `layout` to `"split"` on the beat AND on the shot(s) with the same `beatId`.

### Drop a card

Set `beats[i].visual` to `null`. The renderer skips beats with no visual, so this is safe and the beat keeps its place in the timeline. Optionally set the matching shot's `overlay` to `"none"` for consistency (the renderer does not read it). Do not delete the beat.

### Change or remove a giant word

The renderer draws giant words from `giants[]` only, and within each entry only from `preset.layers[].text`. It does NOT read `shots[].giantWord` or `giants[].word`.

- Change: set `giants[i].preset.layers[j].text` (uppercase, letters, digits, `$%?`, 14 characters max). The layer's `size` was fitted to the old word. If the new word is longer, shrink `size` roughly in proportion to the length ratio, or it spills off the frame. Also update `giants[i].word` and `shots[].giantWord` to match.
- Remove: delete the entry from `giants[]` (the `fg/gN` folder is then unused, leave it). Set that shot's `overlay` to `"none"` and delete its `giantWord`. Do not reorder or renumber the remaining entries; `fgDir` names (`fg/g0`, `fg/g1`) are paths to frames on disk.
- Never touch `cutout`, `fgDir`, `fgFrames`. Without a cut-out the preset was already moved in front of the speaker.

### Change the hook word and line

The renderer reads `hook.preset.layers[]`, not `hook.word` or `hook.line`. Edit `hook.preset.layers[j].text` and `size` (same fitting rule as giants; hook words are 1 or 2 words, 14 characters max, uppercase). Also update `hook.word` to match. `hook.line` is always an empty string and no layer draws it, so there is no line to edit. To change how long the hook lasts, edit `hook.endSec` (the plan uses 2.4 to 4.2 s); also set each layer's `out.at` (a fade, `{type: "fade", at, dur: 0.3}`) to `endSec - 0.3`. Hook style ids (`HookStyleId`): giant_word, giant_number, giant_question, focus_word, ghost_topic. Changing the style needs a different `preset`, so re-plan instead of editing it.

### Swap a camera

Edit `shots[i].camera`. `CameraId` values: base, punch (1.28x snap in), face_closeup (1.5x, tighter than punch), push_in (slow zoom in), drift (slow zoom with a sideways glide). The renderer draws the named camera on both the `full` and the `split` layout; every zoom is capped so the face is never cropped. The only thing it adds is at each time in `cuts`: a `base` shot whose piece would look like the piece before it is flipped to a punch (or to base after a zoomed-in end). A shot you set to anything but `base` is never flipped. Do not edit `beats[].punchIn`; it is only used by old plans that have no `shots`.

### Change caption style

`captionSections` decides the caption style at every moment; `style.captionStyle` is used only if `captionSections` is missing or empty. A fresh plan has sections of about 6 to 12 s with 2 to 4 distinct styles, chosen from Jev's per-section probabilities. Edit `captionSections[].style` (for one style everywhere, set it on every section) and set `style.captionStyle` to match the first section. `CaptionStyleId` values: word_pop, single_word, karaoke_line, boxed_highlight, typewriter_line, anton_karaoke, archivo_chip, inter_editorial. Do not change `start` or `end` of sections. `shots[].captionStyle` is bookkeeping and is not read.

### Change style family or accent

Edit `style.family` and `style.accent`; they colour the cards, captions and panel.

- `family` (`StyleFamilyId`): apple_glass, bold_kinetic, terminal_type, neon_cyber, paper_editorial, clean_swiss, gradient_pop, dark_luxe
- `accent` (`AccentId`): blue, green, yellow, orange, red, pink, purple, cyan

### Change a transition

Edit `shots[i].transitionIn`. When `shots` exists the renderer reads these, not `beats[].transitionIn`. The transition plays centred on that shot's `start`. `TransitionId` values: hard_cut, flash, whip_streak, glass_wipe, zoom_blur, glitch_slice. `hard_cut` draws nothing.

## Rhythm and overrides

After Jev picks cameras and overlays, rhythm rules fix things that would hurt pacing: a visible change at least every 3 s, no repeated camera, a cap on card coverage, at most one giant word per 8 to 10 s. Each change is logged three ways: `rhythm.overrides` (`{shotId, rule, from, to}`), `shots[].overrides` (plain-English reasons) and `shots[].jev` (what Jev originally picked). `rhythm.maxGapSec` and `rhythm.cardCoverage` are the totals afterwards. Nothing reads any of this when rendering. Use it to explain to the user why a shot looks the way it does. If you edit a camera or overlay yourself, the log is not updated and that is fine.

## Things that break the render

- Changing `start`, `end` or `i` on words, beats or shots, or `wordRange`: captions, cards and shots go out of sync.
- Changing `source.path`, `source.durationSec`, `geometry`, `loudness`, `cuts`, or any `fgDir`/`fgFrames`/`cutout`: missing frames, wrong crop or wrong audio level.
- Invalid JSON, or an id (camera, transition, style) not in the lists above. An unknown `visual.template` is skipped with a console warning (the card disappears). A template that throws on bad `fields` is caught and the card disappears, so check the preview after editing fields.
- A longer giant or hook word without a smaller `size`: it runs off the frame.
- Deleting or renaming `beats[]` or `shots[]` entries: ids link them (`shots[].beatId`), and beats must stay contiguous.
