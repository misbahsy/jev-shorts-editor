// verify.ts - checks a finished short the way a viewer would hear and see it.
//
//   npx tsx src/short/verify.ts --video short.mp4 [--work <work dir>] [--out <dir>]
//
// It transcribes the finished MP4 again, so the checks run on what is actually heard,
// not on what the plan intended. Then it reports:
//   - repeats: back-to-back sentences that make the same point, and phrases said twice
//     close together (retakes the clean stage missed);
//   - caption drift: places where the plan's caption words and the heard words disagree
//     (a word chopped by a cut, audio with no caption, a caption with no audio);
//   - pauses: the longest gap inside the short (zero-gap edits should stay near 150 ms);
//   - format: size, length, audio present, integrated loudness;
//   - a contact sheet: one frame per second, 8 per row, so a person or an agent can see
//     the whole edit at a glance.
// Writes report.json, report.md and sheet.png into --out (default <work>/verify, or a
// verify folder next to the video) and prints report.md.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { transcribe, type Word } from "./transcribe";

const STOPWORDS = new Set(
  (
    "a an the and or but so if then than that this these those is are was were be been being am " +
    "i you he she it we they me him her us them my your his its our their to of in on at by for " +
    "with from as into about up down out over just not no do does did done have has had can could " +
    "will would should may might must there here what which who whom whose when where why how all " +
    "any each some such very too also only own same other more most like get got one s t don't it's " +
    "you're i'm that's let's"
  ).split(/\s+/),
);

/** Lowercase, strip surrounding punctuation, keep a decimal point inside numbers ("5.5." -> "5.5"). */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isContent(token: string): boolean {
  return token.length >= 2 && !STOPWORDS.has(token);
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  content: Set<string>;
}

/** Groups words into sentences at terminal punctuation. */
export function sentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      text: cur.map((w) => w.text).join(" "),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      content: new Set(cur.map((w) => norm(w.text)).filter(isContent)),
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')\]]?$/.test(w.text)) flush();
  }
  flush();
  return out;
}

export interface RepeatFinding {
  kind: "restated_sentence" | "repeated_phrase";
  at: number;
  first: string;
  second: string;
  shared: string[];
}

/**
 * Two sentences at most two apart and within 15 s that share at least two content
 * words covering half of the shorter one usually mean a retake survived. A rhetorical
 * repeat can trip this too, so findings are leads to check, not verdicts.
 */
export function findRepeats(words: Word[]): RepeatFinding[] {
  const found: RepeatFinding[] = [];
  const sents = sentences(words);
  // Topic words ("video", "Claude" in a video about Claude editing video) appear in most
  // sentences, so sharing them says nothing about a retake. Drop words that appear in at
  // least four sentences and at least a third of them.
  const df = new Map<string, number>();
  for (const s of sents) for (const t of s.content) df.set(t, (df.get(t) ?? 0) + 1);
  const topic = new Set([...df].filter(([, n]) => n >= 4 && n >= sents.length / 3).map(([t]) => t));
  for (const s of sents) s.content = new Set([...s.content].filter((t) => !topic.has(t)));
  for (let i = 0; i < sents.length; i++) {
    for (let j = i + 1; j <= i + 2 && j < sents.length; j++) {
      const a = sents[i];
      const b = sents[j];
      if (b.start - a.end > 15) break;
      const shared = [...a.content].filter((t) => b.content.has(t));
      const smaller = Math.min(a.content.size, b.content.size);
      if (shared.length >= 2 && smaller > 0 && shared.length / smaller >= 0.5) {
        found.push({ kind: "restated_sentence", at: b.start, first: a.text, second: b.text, shared });
      }
    }
  }
  // Three-word phrases with at least two content words, said twice within 20 s.
  const toks = words.map((w) => ({ t: norm(w.text), start: w.start }));
  const seen = new Map<string, number>();
  const reported = new Set<string>();
  for (let i = 0; i + 2 < toks.length; i++) {
    const tri = [toks[i].t, toks[i + 1].t, toks[i + 2].t];
    if (tri.filter((t) => isContent(t) && !topic.has(t)).length < 2) continue;
    const key = tri.join(" ");
    const prev = seen.get(key);
    if (prev !== undefined && toks[i].start - toks[prev].start <= 20 && !reported.has(key)) {
      const insideSentenceFinding = found.some(
        (f) => f.kind === "restated_sentence" && Math.abs(f.at - toks[i].start) < 8,
      );
      if (!insideSentenceFinding) {
        found.push({ kind: "repeated_phrase", at: toks[i].start, first: key, second: key, shared: tri.filter(isContent) });
      }
      reported.add(key);
    }
    seen.set(key, i);
  }
  return found.sort((x, y) => x.at - y.at);
}

export interface DriftFinding {
  kind: "caption_not_heard" | "heard_not_captioned" | "differs";
  at: number;
  caption: string;
  heard: string;
}

/**
 * Aligns caption words with heard words (longest common subsequence on normalized
 * tokens) and reports every stretch between matches where they disagree.
 */
export function findDrift(caption: Word[], heard: Word[]): DriftFinding[] {
  const a = caption.map((w) => norm(w.text));
  const b = heard.map((w) => norm(w.text));
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DriftFinding[] = [];
  let i = 0;
  let j = 0;
  let gapA: Word[] = [];
  let gapB: Word[] = [];
  const flush = () => {
    if (!gapA.length && !gapB.length) return;
    const kind = !gapB.length ? "caption_not_heard" : !gapA.length ? "heard_not_captioned" : "differs";
    const at = (gapB[0] ?? gapA[0]).start;
    out.push({ kind, at, caption: gapA.map((w) => w.text).join(" "), heard: gapB.map((w) => w.text).join(" ") });
    gapA = [];
    gapB = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) {
      gapA.push(caption[i++]);
    } else {
      gapB.push(heard[j++]);
    }
  }
  flush();
  return out;
}

export interface Pause {
  start: number;
  end: number;
  sec: number;
}

/** Parses ffmpeg silencedetect output into gaps, dropping ones that touch either end of the clip. */
export function parseSilences(stderr: string, durationSec: number): Pause[] {
  const out: Pause[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      const end = Number(e[1]);
      if (start > 0.1 && end < durationSec - 0.1) out.push({ start, end, sec: end - start });
      start = null;
    }
  }
  return out;
}

function probe(video: string) {
  const json = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", video]).toString(),
  );
  const v = json.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const hasAudio = json.streams.some((s: { codec_type: string }) => s.codec_type === "audio");
  return { width: v?.width ?? 0, height: v?.height ?? 0, durationSec: Number(json.format.duration), hasAudio };
}

function ffmpegStderr(args: string[]): string {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.stderr ?? "";
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && argv[i + 1] !== undefined) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.video) {
    console.error("Usage: npx tsx src/short/verify.ts --video short.mp4 [--work <work dir>] [--out <dir>]");
    process.exit(2);
  }
  const video = path.resolve(args.video);
  const work = args.work ? path.resolve(args.work) : undefined;
  const outDir = path.resolve(args.out ?? (work ? path.join(work, "verify") : path.join(path.dirname(video), "verify")));
  mkdirSync(outDir, { recursive: true });

  const info = probe(video);

  const wav = path.join(outDir, "heard.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav]);
  const heard = await transcribe(wav, outDir);

  const repeats = findRepeats(heard);

  const planPath = work ? path.join(work, "plan.json") : undefined;
  let drift: DriftFinding[] | null = null;
  if (planPath && existsSync(planPath)) {
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as { words: Word[] };
    drift = findDrift(plan.words, heard);
  }

  const pauses = parseSilences(ffmpegStderr(["-i", video, "-vn", "-af", "silencedetect=noise=-45dB:d=0.15", "-f", "null", "-"]), info.durationSec)
    .sort((x, y) => y.sec - x.sec);

  const lufsMatch = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(ffmpegStderr(["-i", video, "-vn", "-af", "ebur128", "-f", "null", "-"]));
  const lufs = lufsMatch ? Number(lufsMatch[1]) : null;

  const sheet = path.join(outDir, "sheet.png");
  const rows = Math.max(1, Math.ceil(info.durationSec / 8));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1,scale=216:384,tile=8x${rows}`, "-frames:v", "1", sheet]);

  const formatIssues: string[] = [];
  if (info.width !== 1080 || info.height !== 1920) formatIssues.push(`size is ${info.width}x${info.height}, expected 1080x1920`);
  if (!info.hasAudio) formatIssues.push("no audio stream");
  if (lufs !== null && Math.abs(lufs - -14) > 2) formatIssues.push(`loudness is ${lufs} LUFS, expected about -14`);
  const longPauses = pauses.filter((p) => p.sec > 0.35);

  const report = {
    video,
    durationSec: info.durationSec,
    format: { width: info.width, height: info.height, hasAudio: info.hasAudio, lufs },
    heardText: heard.map((w) => w.text).join(" "),
    repeats,
    drift,
    pauses: { longestSec: pauses[0]?.sec ?? 0, over350ms: longPauses },
    sheet,
    issueCount: repeats.length + (drift?.length ?? 0) + longPauses.length + formatIssues.length,
    formatIssues,
  };
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  const md: string[] = [];
  md.push(`# Verify: ${path.basename(video)}`, "");
  md.push(`- Length ${info.durationSec.toFixed(1)} s, ${info.width}x${info.height}, audio ${info.hasAudio ? "yes" : "NO"}, loudness ${lufs ?? "?"} LUFS`);
  md.push(`- Longest pause inside the short: ${((pauses[0]?.sec ?? 0) * 1000).toFixed(0)} ms; pauses over 350 ms: ${longPauses.length}`);
  md.push(`- Possible repeats: ${repeats.length}`);
  md.push(`- Caption vs heard differences: ${drift ? drift.length : "not checked (no --work)"}`);
  md.push(`- Contact sheet: ${sheet} (one frame per second, 8 per row, left to right)`, "");
  if (formatIssues.length) md.push("## Format", ...formatIssues.map((s) => `- ${s}`), "");
  if (repeats.length) {
    md.push("## Possible repeats");
    for (const r of repeats) {
      md.push(r.kind === "restated_sentence"
        ? `- ${fmt(r.at)} restated: "${r.first}" then "${r.second}" (shared: ${r.shared.join(", ")})`
        : `- ${fmt(r.at)} phrase said twice within 20 s: "${r.first}"`);
    }
    md.push("");
  }
  if (drift?.length) {
    md.push("## Caption vs heard");
    for (const d of drift) {
      const label = d.kind === "caption_not_heard" ? "captioned, not heard" : d.kind === "heard_not_captioned" ? "heard, not captioned" : "differs";
      md.push(`- ${fmt(d.at)} ${label}: caption "${d.caption}" / heard "${d.heard}"`);
    }
    md.push("");
  }
  if (longPauses.length) {
    md.push("## Pauses over 350 ms", ...longPauses.map((p) => `- ${fmt(p.start)} ${(p.sec * 1000).toFixed(0)} ms`), "");
  }
  md.push("## Heard transcript", "", report.heardText, "");
  const text = md.join("\n");
  writeFileSync(path.join(outDir, "report.md"), text);
  console.log(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`verify failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
