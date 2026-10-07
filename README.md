# jev-shorts-editor

Turn a talking-head video into a finished vertical short with one command.

You give it a clip of someone talking to the camera. It gives back a 1080x1920 MP4 with the speaker framed for vertical, animated captions, on-screen graphics timed to what is being said, transitions, and sound effects. There is no timeline to drag around. The edit decisions are made by [Jev](https://typesafe.ai), a fast classifier from TypeSafe, and the on-screen text is written by a small LLM on Groq.

On an Apple Silicon Mac, a 40 second clip takes about 9 seconds to plan and about 2 minutes to fully render.

## What you get

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
| A TypeSafe API key (for Jev) | [typesafe.ai](https://typesafe.ai) |
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
| `--plan <plan.json>` | Reuse a saved plan instead of planning again. |
| `--film <film.html>` | Reuse a built film page instead of building it again. |
| `--progress-json` | Print one JSON event per line on stdout and send human logs to stderr. Useful if you are driving this from another app. |

`--plan` and `--film` are handy when you are changing the look of templates. Plan once, then rerender as often as you like without calling any API.

## How it works

```
input.mp4
  │
  ├─ plan ───── transcribe (parakeet, local)
  │             perceive   (Apple Vision faces + one vision-LLM look at the scene)
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

Each step writes its output into the work folder (`decisions.json`, `beats.json`, `structure.json`, `copy.json`, `plan.json`, `film.html`). If something looks wrong, open those files to see which stage made the call.

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

## Troubleshooting

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
