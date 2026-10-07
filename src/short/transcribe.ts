/**
 * Runs parakeet-mlx on the source clip and flattens its sentence/token JSON
 * into a global word list. Word-merge rule: a
 * token whose text starts with a space begins a new word; word start = its
 * first token's start, end = its last token's end, surface text has leading
 * spaces stripped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";

export interface Word {
  i: number;
  text: string;
  start: number;
  end: number;
}

interface Token {
  text: string;
  start: number;
  end: number;
}
interface Sentence {
  text: string;
  start: number;
  end: number;
  tokens: Token[];
}
export interface ParakeetJson {
  text: string;
  sentences: Sentence[];
}

function mergeSentenceTokens(tokens: Token[], preciseEnds: boolean): { text: string; start: number; end: number }[] {
  const words: { text: string; start: number; end: number }[] = [];
  for (const tok of tokens) {
    const startsNewWord = tok.text.startsWith(" ") || words.length === 0;
    if (startsNewWord) {
      words.push({ text: tok.text.replace(/^\s+/, ""), start: tok.start, end: tok.end });
    } else {
      const cur = words[words.length - 1];
      cur.text += tok.text;
      // parakeet places a trailing "." or "," just before the next word, so letting it stretch
      // the word would swallow the whole pause. The clean stage asks for word ends without it.
      const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(tok.text);
      if (!(preciseEnds && punctuationOnly)) cur.end = tok.end;
    }
  }
  return words;
}

/** Flattens parakeet-mlx JSON into the global word list. */
export function wordsFromParakeet(parsed: ParakeetJson, preciseEnds = false): Word[] {
  const words: Word[] = [];
  for (const sentence of parsed.sentences) {
    for (const w of mergeSentenceTokens(sentence.tokens, preciseEnds)) {
      words.push({ i: words.length, text: w.text, start: w.start, end: w.end });
    }
  }
  return words;
}

/** PARAKEET_BIN, else parakeet-mlx on PATH, else the default `uv tool install` location. */
function resolveParakeet(): string {
  if (process.env.PARAKEET_BIN) return process.env.PARAKEET_BIN;
  try {
    return execFileSync("/usr/bin/which", ["parakeet-mlx"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    const fallback = join(homedir(), ".local/bin/parakeet-mlx");
    if (existsSync(fallback)) return fallback;
    throw new Error("parakeet-mlx not found. Install it with `uv tool install parakeet-mlx`, or set PARAKEET_BIN.");
  }
}

export async function transcribe(srcPath: string, workDir: string, opts: { preciseEnds?: boolean } = {}): Promise<Word[]> {
  const txDir = join(workDir, "tx");
  mkdirSync(txDir, { recursive: true });

  const bin = resolveParakeet();
  execFileSync(
    bin,
    [srcPath, "--model", "mlx-community/parakeet-tdt-0.6b-v3", "--output-format", "json", "--output-dir", txDir],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // parakeet-mlx names the output after the input file's basename.
  const stem = basename(srcPath, extname(srcPath));
  let jsonPath = join(txDir, `${stem}.json`);
  try {
    readFileSync(jsonPath, "utf8");
  } catch {
    // fall back: pick whatever .json landed in txDir
    const found = readdirSync(txDir).find(f => f.endsWith(".json"));
    if (!found) throw new Error(`parakeet-mlx produced no JSON output in ${txDir}`);
    jsonPath = join(txDir, found);
  }

  const raw = readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as ParakeetJson;

  const words = wordsFromParakeet(parsed, opts.preciseEnds ?? false);

  writeFileSync(join(workDir, "words.json"), JSON.stringify(words, null, 2));
  return words;
}
