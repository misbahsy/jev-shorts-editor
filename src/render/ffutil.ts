import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

export function ffmpeg(args: string[], label = "ffmpeg"): void {
  const res = spawnSync("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit ${res.status}):\nffmpeg ${args.join(" ")}\n${res.stderr?.toString().slice(-3000)}`);
  }
}

export function ffprobeDuration(file: string): number {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  if (res.status !== 0) throw new Error(`ffprobe failed on ${file}: ${res.stderr?.toString()}`);
  return parseFloat(res.stdout.toString().trim());
}

export function ffprobeStreams(file: string): { hasVideo: boolean; hasAudio: boolean } {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
  const out = res.stdout.toString();
  return { hasVideo: out.includes("video"), hasAudio: out.includes("audio") };
}

function escapeConcatPath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

export function concatDemuxerCopy(files: string[], outFile: string): void {
  const listPath = outFile + ".list.txt";
  const content = files.map((f) => `file '${escapeConcatPath(path.resolve(f))}'`).join("\n") + "\n";
  writeFileSync(listPath, content, "utf8");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-fps_mode", "cfr", outFile], "concat");
}
