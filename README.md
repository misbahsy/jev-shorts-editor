# jev-shorts-editor

Turn a talking-head video into a finished vertical short with one command.

Give it a raw clip, retakes and dead air included. It cuts the clip clean, then renders a 1080x1920 MP4 with the speaker reframed, animated captions, graphic cards, zooms, transitions and sound effects. Every edit decision is a call to [Jev](https://typesafe.ai) through the `/v1/decisions` route of a [LiteLLM](https://github.com/BerriAI/litellm) gateway.

## Install the skill

```bash
npx skills add misbahsy/jev-shorts-editor
```

Then ask your agent something like "make a short from ~/Movies/talk.mp4". The skill clones the repo, checks your machine, helps you set up keys without pasting them into chat, runs the edit, opens a live preview, and checks the finished MP4 before handing it over.

## Every edit is a decision

A decision call sends a `state` and a set of typed questions, and gets back one answer per question with a probability for every option. Jev is a classifier, not a chat model, so every answer is one of the options the code offered. Nothing to parse, nothing to validate, no retries.

The editor sends these calls to LiteLLM's `POST /v1/decisions`. The proxy holds the TypeSafe key and gives you virtual keys, budgets, spend tracking and request logs for every call. One function, `src/jevClient.ts`, makes all of them.

| When | What Jev decides |
| --- | --- |
| Cleaning | Which repeated lines are real retakes to cut |
| Once per video | Style family, accent color, caption style, opening title, energy, progress bar |
| Every 8 seconds or so | Caption style for that section |
| Every 2 to 3 second shot | Camera (5), overlay (4), card template (18), text effect (8), transition (6), sound effect (6), word to emphasize |

Code turns the answers into a plan. Rhythm rules keep something changing at least every 3 seconds and log every override in `plan.json`. The only generated text is the copy on the cards, written by a small LLM on Groq.

A per-shot request, abridged:

```json
POST /v1/decisions
{
  "model": "jev",
  "state": { "current": "and it finished the refactor in four minutes", "prev": "...", "next": "..." },
  "questions": {
    "camera": {
      "type": "choice",
      "instructions": "How should the camera treat the speaker during CURRENT SHOT?",
      "criteria": { "base": "Steady framing...", "punch": "A quick snap in on a key claim...", "...": "..." }
    }
  }
}
```

```json
{ "answers": { "camera": { "choice": "punch", "confidence": 0.68,
  "probabilities": { "punch": 0.68, "push_in": 0.17, "base": 0.09, "face_closeup": 0.04, "drift": 0.02 } } } }
```

On a real 4.5 minute take that became a 42 second short, the 22 edit requests went out in parallel and finished in 0.51 s (440 ms median), for $0.0023 of Jev usage.

## Run it yourself

macOS 15+ on Apple Silicon. You need Xcode Command Line Tools, Node 20.11+, `ffmpeg`, `uv tool install parakeet-mlx`, a [TypeSafe](https://typesafe.ai) key and a [Groq](https://console.groq.com) key.

1. Start a LiteLLM proxy with the example config. The `/v1/decisions` route is on LiteLLM's `main` branch, so install from source until a release includes it.

   ```bash
   TYPESAFE_API_KEY=... LITELLM_MASTER_KEY=sk-... litellm --config litellm.config.example.yaml --port 4000
   ```

2. Install and add your keys:

   ```bash
   git clone https://github.com/misbahsy/jev-shorts-editor.git
   cd jev-shorts-editor && npm install && cp .env.example .env
   ```

   In `.env`, set `LITELLM_BASE_URL=http://localhost:4000`, `LITELLM_API_KEY` and `GROQ_API_KEY`.

3. Make a short:

   ```bash
   ./src/short/try.sh ~/Desktop/my-take.mp4
   ```

The short lands in `~/Movies/jev-shorts/`. A live `preview.html` is ready in about 10 seconds, before the MP4 finishes. `npm run verify -- --video <short.mp4>` re-checks a finished short.

Each stage writes its output to the work folder (`clean.json`, `decisions.json`, `plan.json`, `film.html`), so you can see which step made each call. `src/short/CONTRACT.md` describes the pipeline.

## Credits

Sound effects in `assets/sfx/` come from [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen under Apache 2.0. See `NOTICE`.

## License

MIT. See `LICENSE`.
