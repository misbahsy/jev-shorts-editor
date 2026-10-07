/**
 * Dev tool: run only the clean stage and print what it did.
 *   npx tsx src/short/clean/cli.ts --in <raw.mp4> --work <dir> [--words <words.json>] [--dry]
 * With --words the transcription is skipped (words need precise ends). Writes REVIEW.md in the
 * work directory's parent: the cleaned transcript and every cut.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Word } from "../transcribe";
import { cleanSource } from "./index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function reviewMarkdown(r: Awaited<ReturnType<typeof cleanSource>>): string {
  const lines: string[] = ["# Clean review", ""];
  const s = r.stats;
  lines.push(`Before ${s.beforeSec.toFixed(1)} s, after ${s.afterSec.toFixed(1)} s. Retake mode: ${s.retakeMode}.`);
  lines.push(`Removed: ${Object.entries(s.removedSec).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(", ")}.`);
  lines.push(`Retakes cut: ${s.retakesCut}. Fillers cut: ${s.fillersCut}. Zoom cut points: ${r.cutPoints.length}.`);
  lines.push(`Take selection: ${s.takeSelection ?? "off"}, ${s.llmDrops ?? 0} retake cuts added by the LLM.`);
  lines.push(`Words recovered from untranscribed speech: ${s.recoveredWords ?? 0}. Voiced spans kept without words: ${s.untranscribedKept ?? 0}.`, "");
  lines.push("## Cleaned transcript", "");
  let para: string[] = [];
  for (const w of r.words) {
    para.push(w.text);
    if (/[.!?]$/.test(w.text)) {
      lines.push(para.join(" "), "");
      para = [];
    }
  }
  if (para.length) lines.push(para.join(" "), "");
  lines.push("## Cuts", "", "| source start | source end | length | reason | source | jev | removed words |", "|---|---|---|---|---|---|---|");
  for (const c of r.cuts) {
    lines.push(`| ${c.start.toFixed(2)} | ${c.end.toFixed(2)} | ${(c.end - c.start).toFixed(2)} | ${c.reason} | ${c.source ?? ""} | ${c.jev?.toFixed(2) ?? ""} | ${c.text}${c.why ? ` (${c.why})` : ""} |`);
  }
  if (r.keptSpans.length) {
    lines.push("", "## Kept without words", "", "| source start | source end | reason |", "|---|---|---|");
    for (const k of r.keptSpans) lines.push(`| ${k.start.toFixed(2)} | ${k.end.toFixed(2)} | ${k.reason} |`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const src = arg("in");
  const work = arg("work");
  if (!src || !work) {
    console.error("usage: cli.ts --in <raw.mp4> --work <dir> [--words <words.json>] [--dry]");
    process.exit(1);
  }
  const wordsPath = arg("words");
  const words = wordsPath ? (JSON.parse(readFileSync(wordsPath, "utf8")) as Word[]) : undefined;
  const t = Date.now();
  const r = await cleanSource(path.resolve(src), path.resolve(work), {
    words,
    dryRun: process.argv.includes("--dry"),
    log: m => console.error(m),
  });
  const out = path.join(path.dirname(path.resolve(work)), "REVIEW.md");
  writeFileSync(out, reviewMarkdown(r));
  console.log(JSON.stringify({ ms: Date.now() - t, stats: r.stats, cutPoints: r.cutPoints.length }, null, 1));
  console.log(`review: ${out}`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
