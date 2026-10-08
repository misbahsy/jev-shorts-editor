# jev-shorts-editor

Turn a talking-head video into a finished vertical short with one command.

You give it a clip of someone talking to the camera, retakes and dead air included. It cleans the clip up first, then gives back a 1080x1920 MP4 with the speaker framed for vertical, animated captions, on-screen graphics timed to what is being said, transitions, and sound effects. There is no timeline to drag around. Every edit decision is a call to [Jev](https://typesafe.ai), a fast classifier from TypeSafe, made through the `/v1/decisions` route of a [LiteLLM](https://github.com/BerriAI/litellm) gateway or straight to TypeSafe. The on-screen text is written by a small LLM on Groq.

On an Apple Silicon Mac, a 40 second clip takes about 9 seconds to plan and about 2 minutes to fully render.

## Every edit is a decision: Jev through LiteLLM

This project is a working example of one idea: an editor where every editing choice is a *decision*, not generated text.

A decision call sends a `state` (what is known so far) and a set of typed questions. It gets back one answer per question, with a probability for every option. [Jev](https://typesafe.ai) from TypeSafe answers them. Jev is a classifier, not a chat model, so every answer is one of the options the code offered. There is nothing to parse, nothing to validate and no retry for malformed output. Calls take a few hundred milliseconds, and planning a whole edit costs about a quarter of a cent.

[LiteLLM](https://github.com/BerriAI/litellm) carries those calls. Its proxy has a `POST /v1/decisions` route, so Jev sits behind the same gateway as your other models. The proxy holds the TypeSafe key and adds virtual keys, budgets, spend tracking and request logs. Set `LITELLM_BASE_URL` and every Jev call in the editor goes through the gateway; leave it unset and the calls go straight to TypeSafe. One function in `src/jevClient.ts` makes all of them and sends the same body either way.

### What Jev decides

| When | Question | Question type | Options |
| --- | --- | --- | --- |
| Cleaning | Is this repeat a real retake that should be cut? One question per candidate, all in one request | noul (a yes/no score) | |
| Once per video | Style family | choice | 8 |
| | Accent color | choice | 8 |
| | Caption style | choice | 8 |
| | Opening title look | choice | 5 |
| | Speaker energy | score | |
| | Show a progress bar? | noul | |
| Once per section | Caption style for this section | choice | 8 |
| Every 2 to 3 second shot | Camera (steady, punch-in, face close-up, push-in, drift) | choice | 5 |
| | Overlay (none, card, keyword pill, giant word) | choice | 4 |
| | Card template | choice | 18 |
| | Text effect | choice | 8 |
| | Transition into the shot | choice | 6 |
| | Sound effect | choice | 6 |
| | Which word to emphasize | choice | the shot's words |

Code turns the answers into a plan. Rhythm rules make sure something visible changes at least every 3 seconds, the same camera never plays twice in a row, and cards are up for no more than about half the video. Each time a rule overrides Jev, the override is logged in `plan.json`. The only generated text in the video is the copy on the cards and the hook, which a small LLM on Groq writes.

### One request

Here is an abridged per-shot request. The text and probabilities are made up, but the shape is what the editor sends:

```json
POST /v1/decisions
{
  "model": "jev",
  "state": {
    "footage": "one speaker, seated, centered, looking at the camera",
    "transcript": "the whole cleaned transcript",
    "currentShot": 7,
    "current": ">>> CURRENT SHOT 7: \"and it finished the refactor in four minutes\"",
    "prev": "so I gave it the whole repo",
    "next": "which used to take me a full day"
  },
  "questions": {
    "camera": {
      "type": "choice",
      "instructions": "How should the camera treat the speaker during CURRENT SHOT, given PREV and NEXT?",
      "criteria": {
        "base": "Steady medium framing of the speaker...",
        "punch": "A quick snap in... The line lands a key claim, a number, a punchline...",
        "face_closeup": "A tight close-up on the speaker's face...",
        "push_in": "A slow steady zoom toward the face across the whole shot...",
        "drift": "A slow sideways glide with a slight zoom..."
      }
    },
    "transition": { "type": "choice", "instructions": "Which transition (if any) should play on the cut INTO CURRENT SHOT, given PREV?", "criteria": { "...": "..." } },
    "sfx": { "type": "choice", "instructions": "Which sound effect (if any) best punctuates the cut into CURRENT SHOT?", "criteria": { "...": "..." } }
  }
}
```

And the answer:

```json
{
  "model": "jev",
  "answers": {
    "camera": { "type": "choice", "choice": "punch", "confidence": 0.68,
                "probabilities": { "punch": 0.68, "push_in": 0.17, "base": 0.09, "face_closeup": 0.04, "drift": 0.02 } },
    "transition": { "type": "choice", "choice": "whip_streak", "confidence": 0.52, "probabilities": { "...": 0 } },
    "sfx": { "type": "choice", "choice": "whoosh", "confidence": 0.61, "probabilities": { "...": 0 } }
  },
  "usage": { "input_tokens": 2510, "output_tokens": 494 }
}
```

The shot requests don't depend on each other, so all of them go out at once.

### Numbers from a real run

A 4 minute 31 second talking-head take with plenty of retakes became a 42 second short. Its plan was made twice: once through a LiteLLM proxy running on the same Mac, and once direct.

| | Through LiteLLM `/v1/decisions` | Direct to TypeSafe |
| --- | --- | --- |
| Decision requests | 23: 1 for 26 retake candidates, 22 for the edit | 23 |
| Wall time for the 22 edit requests | 0.51 s | 0.19 s |
| Median request latency | 440 ms | 186 ms |
| Jev cost for the edit | $0.0023 | $0.0023 |
| Whole plan, including local transcription and cut-outs | 55 s | 49 s |

Jev's time is under a second of planning either way. Most of the plan is spent on local transcription, the retake cut and the cut-out mattes.

## What you get

- **A clean take.** Retakes, dead air and filler sounds are cut out before anything else happens. When you say a line twice, only the last take stays: Jev confirms the repeats found by matching, and a small LLM on Groq reads the whole transcript for any take the matching missed, with code checks so it can never drop the last take of a line. It also drops the weaker of two back-to-back rewordings of one claim, and dangling scraps of quiet speech. Cuts follow the sound in the audio, not the transcript timestamps, and leave about 50 ms before a word and 80 ms after it, so joins have no audible gap. Long pauses shrink to that, and the silence before the first word and after the last one is trimmed. Audio that sounds like speech is never cut just because the transcript missed it: those stretches are transcribed again, and any that still have no words are kept. The cleaned clip is transcribed once more and those words drive the captions, so they match what you hear. Every cut is written to `clean.json` in the work folder.
- **Something new every 2 to 3 seconds.** The clip is split into shots of about 2 to 3 seconds at natural pauses. Jev picks a camera for each one (normal, punch-in, face close-up, slow push-in, slow drift), plus an overlay (card, keyword pill, giant word behind your head or nothing), a text effect, a transition and a sound effect. Rhythm rules in code keep it watchable: a visible change at least every 3 seconds, no repeated camera, a cap on how much of the video is covered by cards, and a clean hook. Every time a rule overrides Jev, it is logged in `plan.json` under `rhythm`. Audio is faded at every join.
- **Giant words behind you.** One big word sits behind your head, with you cut out in front of it, at the hook and a few times later.
- **Consistent loudness.** The final mix is high-passed and normalized to about -14 LUFS with a true peak of -1 dBTP.
- **Vertical reframing.** Faces are found with Apple Vision, so the speaker stays in frame when a wide shot becomes 9:16.
- **Animated captions** that change style every 6 to 12 seconds. Jev scores the eight caption styles for each section, and a short video uses two to four of them, never the same one twice in a row.
- **Cameras drawn as Jev picks them.** A punch-in is 1.28x and a face close-up 1.5x, on both the full and the split layout, and every zoom is capped so the face is never cropped. The renderer only adds a camera of its own at a jump cut inside a steady shot, where it punches in so the cut looks deliberate.
- **Graphic cards** picked per phrase from 18 templates, such as stat callouts, checklists, quotes, versus panels and code terminals.
- **One look per video.** Jev picks a style family and an accent color that fit the content, and the whole short uses them.
- **Transitions and sound effects** placed on the beats that need them.
- **A live preview** (`preview.html`) you can watch in a browser before the MP4 finishes encoding.

## Use it as a Claude Code skill

This repo is also a Claude Code plugin. Install it from inside Claude Code:

```
/plugin marketplace add misbahsy/jev-shorts-editor
/plugin install jev-shorts-editor@jev-shorts-editor
```

Then ask Claude something like "make a short from ~/Movies/talk.mp4". The skill checks your machine with `npm run doctor`, helps you set up the API keys without them ever going into the chat, runs the edit, and opens the live preview. When the MP4 is done it re-checks the result with `npm run verify` and fixes what it finds, for example a misspelled caption word, by editing the plan and re-rendering.

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

To check a finished short, run the verifier on the MP4:

```bash
npm run verify -- --video out.mp4 --work <work dir>
```

It transcribes the finished MP4 again and reports repeated lines, places where the captions and the heard words disagree, the longest pauses, loudness, and a contact sheet with one frame per second. It writes `report.md`, `report.json` and `sheet.png` into a `verify` folder (inside the work folder when you pass `--work`, otherwise next to the video). `--work` is optional but needed for the caption comparison; `--out <dir>` picks another folder.

## Using a LiteLLM gateway

Without a gateway the editor calls TypeSafe directly. To send every Jev call through LiteLLM's `/v1/decisions` route instead (see [Every edit is a decision](#every-edit-is-a-decision-jev-through-litellm) for why you might):

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
  │             decide     (Jev picks style, then per shot: camera, overlay, text effect,
  │                         transition, sfx; rhythm rules fix what would look repetitive)
  │             structure  (merge and space the beats)
  │             hold       (decide how long each graphic stays up)
  │             copy       (Groq writes the short on-screen text for each card)
  │             finalize + geometry (layout, crop, safe areas)
  │             cutouts    (Apple Vision person matte for the hook and giant words)
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

**Caption styles (8):** word_pop, single_word, karaoke_line, boxed_highlight, typewriter_line, anton_karaoke, archivo_chip, inter_editorial.

**Cameras (5):** base, punch, face_closeup, push_in, drift.

**Overlays (4):** none, card, keyword_pill, giant_word.

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

MIT. See `LICENSE`. The bundled sound effects keep their own Apache 2.0 license (see Credits).
