/** The take-selection prompt. Kept short on purpose: the model only drops, the code checks. */

export function buildTakesPrompt(transcript: string): string {
  return `You edit a raw talking-head recording. The speaker often says a line, stops, and says it again. Below, one line per phrase: [start-end seconds], then the words, each followed by its index in {braces}.

Decide which words to DROP so the final video has one clean take of everything the speaker means to say.

Rules:
- Keep the LAST take of a repeated line, unless an earlier take is clearly cleaner (fewer slips, no trailing "because it").
- Drop abandoned starts, stutters and restarts ("Now you definitely need Opus 5.5 for this because it" followed by a full redo).
- Keep a slip only when no better take of that line exists.
- Do NOT drop a line just because it shares a topic or a few words with another. Drop it only if the later take says the SAME sentence again, nearly word for word. A headline and its explanation, or a claim and its consequence, are different lines: keep both.
- Two neighbouring sentences that make the SAME claim in different words are one line said twice (for example "X just killed Y." then "X just killed Y with Z." then "With Z, you don't need Y."). Keep the single best one (the later, unless the earlier is clearly cleaner) and drop the other as ONE range. A claim followed by its consequence, an example, or the next item of a list is not a repeat: keep both.
- A line marked (quiet pickup) was only heard on a second, closer listen. It is usually a dangling scrap: the tail of a sentence, an aside, or words that trail off. Drop it unless it is a complete sentence that adds something new.
- Drop a whole abandoned take as ONE range, from its first word to its last. Do not cut a take into small pieces.
- A single stray word before the real sentence ("One" then "first one is...") is a slip: drop it.
- Never drop the only take of anything. Never invent words or times.
- Boundaries: drop whole words only, as inclusive index ranges.

Answer with JSON only:
{"drops":[{"from":<first word index>,"to":<last word index>,"reason":"<short reason>"}]}
Use {"drops":[]} if nothing needs dropping.

TRANSCRIPT
${transcript}`;
}
