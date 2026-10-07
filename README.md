# jev-shorts-editor

Turn a talking-head video into a finished vertical short with one command.

You give it a clip of someone talking to the camera, retakes and dead air included. It cleans the clip up first, then gives back a 1080x1920 MP4 with the speaker framed for vertical, animated captions, on-screen graphics timed to what is being said, transitions, and sound effects. There is no timeline to drag around. The edit decisions are made by [Jev](https://typesafe.ai), a fast classifier from TypeSafe, and the on-screen text is written by a small LLM on Groq.

On an Apple Silicon Mac, a 40 second clip takes about 9 seconds to plan and about 2 minutes to fully render.

## What you get

- **A clean take.** Retakes, dead air and filler sounds are cut out before anything else happens. When you say a line twice, only the last take stays: Jev confirms the repeats found by matching, and a small LLM on Groq reads the whole transcript for any take the matching missed, with code checks so it can never drop the last take of a line. Cuts follow the sound in the audio, not the transcript timestamps, and leave about 50 ms before a word and 80 ms after it, so joins have no audible gap. Long pauses shrink to that, and the silence before the first word and after the last one is trimmed. Audio that sounds like speech is never cut just because the transcript missed it: those stretches are transcribed again, and any that still have no words are kept. Every cut is written to `clean.json` in the work folder.
- **Cuts that do not jump.** The framing alternates between normal and a slight punch-in at each cut, so a jump cut reads as a camera change. Audio is faded at every join.
- **Consistent loudness.** The final mix is high-passed and normalized to about -14 LUFS with a true peak of -1 dBTP.
- **Vertical reframing.** Faces are found with Apple Vision, so the speaker stays in frame when a wide shot becomes 9:16.
- **Animated captions** in one of five styles.
- **Graphic cards** picked per phrase from 18 templates, such as stat callouts, checklists, quotes, versus panels and code terminals.
- **One look per video.** Jev picks a style family and an accent color that fit the content, and the whole short uses them.
- **Transitions and sound effects** placed on the beats that need them.
- **A live preview** (`preview.html`) you can watch in a browser before the MP4 finishes encoding.

## Requirements

This runs on macOS only. The renderer uses WebKit and the face tracker uses Apple Vision.

| Need | How to get it |
| --- | --- |
| A Mac with Apple Silicon, macOS 15 or later | |
| Xcode Command Line Tools (for `swiftc`) | `xcode-select --install` |
| Node.js 20.11 or later | [nodejs.org](https://nodejs.org) or `brew install node` |
| ffmpeg and ffprobe | `brew install ffmpeg` |
| parakeet-mlx (local speech to text) | `uv tool install parakeet-mlx` |
| A TypeSafe API key (for Jev), or a LiteLLM gateway that has one | [typesafe.ai](https://typesafe.ai) |
| A Groq API key | [console.groq.com](https://console.groq.com) |

Transcription runs on your machine. The first run downloads the parakeet model (`mlx-community/parakeet-tdt-0.6b-v3`), which takes a minute. If `parakeet-mlx` is not on your `PATH`, set `PARAKEET_BIN` to its full path.

The two small native helpers (the frame renderer and the face tracker) are compiled from source the first time you run the tool. That takes a few seconds and lands in `bin/`.

## Quick start

```bash
git clone https://github.com/misbahsy/jev-shorts-editor.git
cd jev-shorts-editor
npm install
cp .env.example .env
```

Open `.env` and fill in `TYPESAFE_API_KEY` and `GROQ_API_KEY`. Environment variables with the same names also work and take priority over the file.

Then point it at a video:

```bash
./src/short/try.sh ~/Desktop/my-take.mp4
```

The finished short is written to `~/Movies/jev-shorts/my-take-short.mp4`. Existing files are never overwritten; a second run gives `my-take-short-2.mp4`. When it finishes it prints the output path, the time it took, and the style Jev picked.

To write somewhere else, set `JEV_OUT_DIR`:

```bash
JEV_OUT_DIR=~/Desktop/shorts ./src/short/try.sh ~/Desktop/my-take.mp4
```

## Running the CLI directly

`try.sh` is a thin wrapper. For full control, call the orchestrator yourself:

```bash
npm run short -- --in input.mp4 --out short.mp4
```

| Flag | What it does |
| --- | --- |
| `--in <file>` | Source video. Required. |
| `--out <file>` | Where to write the MP4. Required. |
| `--work <dir>` | Folder for intermediate files. Defaults to `.short-work` next to the output. |
| `--title "..."` | A working title that gives the copywriter some context. |
| `--workers N` | Number of parallel frame renderers. Default is 6. |
| `--preview [file]` | Also write `preview.html`, which plays the edit live over the source video. |
| `--no-export` | Stop after planning and the preview. Skip frame capture and encoding. |
| `--no-clean` | Skip the clean step and use the video as it is: no cuts, no loudness normalization. |
| `--plan <plan.json>` | Reuse a saved plan instead of planning again. |
| `--film <film.html>` | Reuse a built film page instead of building it again. |
| `--progress-json` | Print one JSON event per line on stdout and send human logs to stderr. Useful if you are driving this from another app. |

`--plan` and `--film` are handy when you are changing the look of templates. Plan once, then rerender as often as you like without calling any API.

## Using a LiteLLM gateway

By default the editor calls TypeSafe directly. If you already run a [LiteLLM](https://github.com/BerriAI/litellm) proxy for your keys, budgets and logs, you can send the Jev calls through its `/v1/decisions` route instead.

1. Start LiteLLM with a model group for Jev. `litellm.config.example.yaml` in this repo is a minimal config:

   ```bash
   TYPESAFE_API_KEY=... LITELLM_MASTER_KEY=sk-... litellm --config litellm.config.example.yaml --port 4000
   ```

2. Add these to `.env`:

   ```bash
   LITELLM_BASE_URL=http://localhost:4000
   LITELLM_API_KEY=sk-...        # the master key, or a virtual key from the proxy
   JEV_MODEL=jev                 # optional, the model_name in your LiteLLM config
   ```

When `LITELLM_BASE_URL` is set, the editor no longer needs `TYPESAFE_API_KEY`; the proxy holds it. Groq calls still go straight to Groq.

A few things to know:

- The `/v1/decisions` route was merged into LiteLLM's `main` branch in early October 2026 and is not in a tagged release yet. Install LiteLLM from source until a release includes it.
- An open LiteLLM pull request ([#44955](https://github.com/BerriAI/litellm/pull/44955)) would switch this route to a different request format. If your proxy has that change, requests fail with a 400 and the editor tells you the gateway expects the newer format. Direct mode keeps working either way.

## How it works

```
input.mp4
  │
  ├─ clean ──── transcribe the raw clip once (parakeet, local)
  │             find retakes, dead air and filler sounds; Jev confirms each retake,
  │             an LLM on Groq picks up takes the matching missed
  │             cut them out with one ffmpeg pass
  │           → clean.mp4, clean.json (every cut and why)
  │
  ├─ plan ───── perceive   (Apple Vision faces + one vision-LLM look at the scene)
  │             decide     (Jev picks style, captions, a template per phrase, transitions)
  │             structure  (merge and space the beats)
  │             hold       (decide how long each graphic stays up)
  │             copy       (Groq writes the short on-screen text for each card)
  │             finalize + geometry (layout, crop, safe areas)
  │           → plan.json
  │
  ├─ film ───── one HTML page that draws every frame as a pure function of time
  │           → film.html, preview.html
  │
  └─ render ─── N WebKit workers capture frames in parallel,
                ffmpeg composites them over the reframed video with VideoToolbox
              → short.mp4
```

Everything after the clean step works on `clean.mp4`, with the words moved onto its timeline. Each step writes its output into the work folder (`clean.json`, `decisions.json`, `beats.json`, `structure.json`, `copy.json`, `plan.json`, `film.html`). If something looks wrong, open those files to see which stage made the call.

`src/short/CONTRACT.md` is the design contract the pipeline was built against. Read it if you want to change how decisions are made.

## Templates and styles

**Graphic templates (18):** big_statement, stamp, keyword_pill, stat_number, dual_stat, numbered_point, checklist, flow_steps, icon_row, option_chips, versus, yes_no, scale_slider, confidence_meter, definition, quote, chat_bubble, code_terminal.

**Style families (8):** apple_glass, bold_kinetic, terminal_type, neon_cyber, paper_editorial, clean_swiss, gradient_pop, dark_luxe.

**Accents (8):** blue, green, yellow, orange, red, pink, purple, cyan.

**Caption styles (5):** word_pop, single_word, karaoke_line, boxed_highlight, typewriter_line.

**Transitions (6):** hard_cut, flash, whip_streak, glass_wipe, zoom_blur, glitch_slice.

Templates live in `src/short/film/templates/`, one file each. The descriptions Jev reads when choosing between them are in `src/short/menus.ts`. To add a template, write the file, add its id to `src/short/types.ts`, and describe when it should be used in `menus.ts`.

## Speed

Measured on an M-series MacBook with a 40 second 1600x852 clip:

| Stage | Time |
| --- | --- |
| Plan (transcribe, perceive, decide, copy) | 9 s |
| Frame capture, 6 workers, 1202 frames | 84 s |
| Encode | 12 s |
| **Total** | **about 110 s** |

The preview is ready as soon as planning ends, so you can watch the edit at the 10 second mark and decide whether the export is worth waiting for. More workers help on machines with more performance cores.

The clean stage adds time up front, mostly the one transcription plus the ffmpeg cut. On a 4.5 minute raw take it ran about 37 seconds and produced a 48 second short, with about 145 seconds wall clock end to end including export. Use `--no-clean` to skip it for footage that is already tight.

## Troubleshooting

**It cut something I wanted.** Open `clean.json` in the work folder. Each cut lists its time range, the reason (`retake`, `silence`, `filler`, `lead` or `tail`), the source that decided it (`jev`, `llm`, `jev+llm` or `rule`) and the words that were removed. The `takeSelection` block lists every drop the LLM proposed with its reason and whether the code accepted it. Voiced stretches that were kept because they had no transcribed words are listed under `kept` as `untranscribed_kept`. Retakes also carry the Jev score that approved them. If Groq is unreachable the LLM pass is skipped with a warning and the Jev retakes still apply. If the cuts are wrong for your clip, run again with `--no-clean` to use the video untouched.

**`TYPESAFE_API_KEY is not set` or `GROQ_API_KEY is not set`.** Copy `.env.example` to `.env` in the repo root and fill in both keys, or export them in your shell.

**`swiftc` fails or is not found.** Install the Command Line Tools with `xcode-select --install`. If you have full Xcode, make sure `xcode-select -p` points at it.

**`parakeet-mlx` not found.** Install it with `uv tool install parakeet-mlx`, or set `PARAKEET_BIN=/full/path/to/parakeet-mlx`.

**`dependencies are not installed`.** Run `npm install` in the repo folder.

**The run failed partway.** `try.sh` keeps the work folder and prints its path. The JSON files in it show how far it got.

**Rendering is slow.** Close other heavy apps, or try `--workers 4` on machines with fewer cores. For a quick look, use `--no-export --preview` and open the preview in a browser.

**The copy step fails.** If the Groq call fails, the copy step tries the `claude` CLI as a fallback. If you don't have it installed, the run stops there. Check that your Groq key is valid.

## Development

```bash
npm run typecheck        # TypeScript check, no output files
npm run build:renderer   # rebuild the WebKit frame renderer by hand
```

`src/short/film/fixtures/samplePlan.ts` builds a test plan from the work folder of an earlier run, so you can work on templates and captions without calling any API again.

## Credits

The sound effects in `assets/sfx/` come from [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen, used under the Apache License 2.0. See `NOTICE` and `assets/sfx/LICENSE-HYPERFRAMES`.

## License

No license has been chosen yet. Until one is added, all rights are reserved.
