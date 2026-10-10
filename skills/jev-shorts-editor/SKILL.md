---
name: jev-shorts-editor
description: Turns a talking-head video on a Mac into a finished, edited 1080x1920 vertical short with captions, punch-in zooms, animated text cards, transitions, sound effects, and retakes and pauses cut out. It runs end to end on the user's machine and opens a live preview in about a minute. Use this whenever someone wants to edit, cut, clip, caption or "make a short / reel / TikTok / YouTube Short" from a recording of a person talking, wants retakes or dead air removed from a talking-head clip, wants to repurpose a long video into a vertical short, or asks to run or fix jev-shorts-editor, even if they never name the tool.
compatibility: macOS 15+ on Apple silicon. Needs node 20.11+, ffmpeg, swiftc, uv + parakeet-mlx, a LiteLLM gateway with a Jev (TypeSafe) key behind it, and a Groq key.
---

# Jev shorts editor

This skill does the whole job for the user: setup, the edit, a check of the result, and fixes. The user gives you a video; you hand back a finished MP4 they can post.

Under the hood is the jev-shorts-editor repo. It cleans retakes and pauses, transcribes on device, asks Jev to choose shots, zooms, text effects, caption style and transitions every 2 to 3 seconds, then renders native graphics over the video with WebKit and ffmpeg. Audio and video stay on the Mac; only transcript text goes out to Jev and Groq. Mention that if the user asks about privacy.

All scripts live in `scripts/` next to this file. Call them by absolute path. They find the repo checkout on their own (`$JEV_REPO`, then the current directory, then `~/jev-shorts-editor`).

## 1. Check the machine

```bash
bash <skill-dir>/scripts/doctor.sh
```

It prints `ok` or `MISSING` with the exact fix for each requirement and exits 0 when ready.

- **No checkout:** ask the user if you may clone it to `~/jev-shorts-editor`. Then run `git clone https://github.com/misbahsy/jev-shorts-editor.git ~/jev-shorts-editor && cd ~/jev-shorts-editor && npm install`.
- **Missing tools (brew, uv, npm):** tell the user what you will install and run the printed fixes once they agree. Installing software on someone's machine is their call.
- **swiftc missing:** `xcode-select --install` opens an Apple dialog that the user has to click through themselves. Ask them to do it and tell you when it finishes.
- **Keys missing:** run `bash <skill-dir>/scripts/keys.sh`. It opens the key file in TextEdit so the user can paste keys there. Never ask the user to paste keys into chat, and never read, cat or print that file; keys in a chat transcript are leaked keys. Tell them:
  - Jev goes through a LiteLLM gateway: `LITELLM_BASE_URL` (default `http://localhost:4000`) and `LITELLM_API_KEY`. The gateway holds the TypeSafe key. If they don't run one yet, point them at the README's quick start, which starts the proxy with `litellm.config.example.yaml`;
  - without a gateway, they can leave `LITELLM_BASE_URL` empty and set `TYPESAFE_API_KEY` to call TypeSafe directly;
  - `GROQ_API_KEY` comes from console.groq.com.

Rerun doctor until it says `ready.`

## 2. Make the short

Get the path to the clip; ask for it if the user hasn't given one. Then run:

```bash
bash <skill-dir>/scripts/run.sh "<clip>" [--out-dir DIR] [--no-clean] [--title "..."] [--preview-only]
```

- It blocks until the MP4 is written, so give the command a long timeout (15 minutes). A 4-minute clip takes about 2 minutes on an M-series Mac.
- After about a minute it prints `preview ready` and opens `preview.html`, which plays the full edit live. Tell the user it's up so they can start watching while the export finishes.
- Output defaults to `~/Movies/jev-shorts/<name>-short.mp4`, with its work folder `<name>-short-work/` alongside. Nothing is ever overwritten.
- `--preview-only` skips the MP4 export, for a quick look.
- `--no-clean` keeps every take. Use it when the user wants their exact delivery kept.
- `--title` sets the hook card text. The default is the filename.

The last lines are `output:`, `source length:`, `length:`, `work:`, `preview:`, `log:`, `seconds:` and `style:`. If it fails, read the tail of `log:`. The error messages name the failing stage and usually the fix. Rerun doctor if a tool seems to be missing.

## 3. Check the result before handing it over

Don't trust the edit blind. Re-transcribe what was actually rendered:

```bash
bash <skill-dir>/scripts/verify.sh "<output mp4>"
```

It prints a report (also saved as `<work>/verify/report.md`) and writes `<work>/verify/sheet.png`, one frame per second, 8 per row. Read the report, then open the sheet image and look at it. You are checking what a viewer would notice:

- **Possible repeats:** the same point said twice close together usually means a retake slipped through. Some are deliberate emphasis; judge from the text.
- **Caption vs heard:** a "differs" line where the heard word is a cut-off version of the caption ("5.5" heard as "5") means a cut landed inside a word. A spelling difference ("Claude" heard as "Cloud") is usually just the speech model guessing, so check the caption itself is right.
- **Pauses over 350 ms:** dead air the cuts missed.
- **Contact sheet:** text running off the frame or covering the face, the same framing for many seconds in a row, blank or black frames.

## 4. Fix what's wrong

Most fixes are quick edits to `<work>/plan.json` followed by a re-render from that plan. A re-render skips transcription and Jev, so it's fast and deterministic:

```bash
cd <repo> && node_modules/.bin/tsx src/short/auto.ts --in "<clip>" --out "<new name>.mp4" \
  --work "<work>" --plan "<work>/plan.json" --preview "<work>/preview.html"
```

Write to a new output name so the user can compare. Read `references/plan.md` before editing the plan; it describes every field and what is safe to change.

| What's wrong | Fix |
|---|---|
| A caption word is misspelled (names, products) | Fix its `text` in `plan.words`, then re-render from the plan |
| A card says something off | Edit that beat's `visual.fields`, or set `visual` to null to drop the card |
| A giant word or the hook word is wrong | Edit the `text` in `giants[].preset.layers` or `hook.preset.layers` (the renderer reads only those). Lower `size` if the new word is longer |
| A retake survived, or a good line was cut | The clean stage made that call. Look at `<work>/clean.json` (cuts and the reason for each) and tell the user what it kept and dropped. Rerun from the clip with `--no-clean` if they'd rather keep everything |
| Too long for the platform | Rerun from the clip; long talks need trimming before the edit (pick the segment with the user, cut it with ffmpeg, run on that) |
| Style or caption look not to taste | Edit `plan.style.family` or `accent`. Caption looks come from `captionSections[].style`, not `style.captionStyle` |
| Pipeline error | Read `log:`, fix the cause (often a missing tool or key), rerun |

After a fix, run verify again on the new file.

## 5. Report back

Keep the hand-off short and concrete:

- the output path, and the length in and out ("4:31 of footage became a 0:52 short");
- how long it took, and that the preview was watchable after about a minute;
- the look Jev chose (style family, caption style, number of shots);
- anything verify still flags, in plain words, plus the fix you'd suggest.

Offer to fix anything they spot. Point them at the preview page for quick review and the MP4 for posting.
