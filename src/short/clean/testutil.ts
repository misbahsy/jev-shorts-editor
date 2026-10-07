/** Helpers for the clean-stage tests: synthetic word lists, no real speech. */
import type { Word } from "../transcribe";

/**
 * Builds words from a script. Tokens are separated by spaces; a token of the form "~0.5" is a
 * pause of that many seconds. Every word lasts `dur` seconds, with `gap` seconds between words.
 */
export function script(text: string, opts: { dur?: number; gap?: number; t0?: number } = {}): Word[] {
  const dur = opts.dur ?? 0.3;
  const gap = opts.gap ?? 0.05;
  let t = opts.t0 ?? 0;
  const out: Word[] = [];
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("~")) {
      t += Number(tok.slice(1));
      continue;
    }
    out.push({ i: out.length, text: tok, start: t, end: t + dur });
    t += dur + gap;
  }
  return out;
}
