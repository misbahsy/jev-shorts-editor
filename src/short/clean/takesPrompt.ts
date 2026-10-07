/** The take-selection prompt. Kept short on purpose: the model only drops, the code checks. */

export function buildTakesPrompt(transcript: string): string {
  return `You edit a raw talking-head recording. The speaker often says a line, stops, and says it again. Below, one line per phrase: [start-end seconds], then the words, each followed by its index in {braces}.

Decide which words to DROP so the final video has one clean take of everything the speaker means to say.

Rules:
- Keep the LAST take of a repeated line, unless an earlier take is clearly cleaner (fewer slips, no trailing "because it").
- Drop abandoned starts, stutters and restarts ("Now you definitely need Opus 5.5 for this because it" followed by a full redo).
- Keep a slip only when no better take of that line exists.
- Do NOT drop a line just because it shares a topic with another. Drop it only if the speaker is saying the SAME sentence again. A headline and its explanation, or a claim and its consequence, are different lines: keep both.
- A single stray word before the real sentence ("One" then "first one is...") is a slip: drop it.
- Never drop the only take of anything. Never invent words or times.
- Boundaries: drop whole words only, as inclusive index ranges.

Answer with JSON only:
{"drops":[{"from":<first word index>,"to":<last word index>,"reason":"<short reason>"}]}
Use {"drops":[]} if nothing needs dropping.

TRANSCRIPT
${transcript}`;
}
