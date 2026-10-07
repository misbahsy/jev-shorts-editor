/**
 * Joins the KEEP ranges into one file with a single ffmpeg call. Video is cut by frame number
 * and audio by sample number, so every range is exact, not "near the timestamp". Each audio
 * segment fades in and out over JOIN_FADE_SEC so a join never pops.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Range } from "./types";
import { JOIN_FADE_SEC } from "./constants";

export interface CutSpec {
  src: string;
  out: string;
  keeps: Range[];
  fps: number;
  sampleRate: number;
  /** Where the filter graph is written (kept for debugging). */
  scriptPath: string;
}

/** The filter graph for the keep ranges. Exported so tests can check it without ffmpeg. */
export function buildCutFilter(keeps: Range[], fps: number, sampleRate: number, fade = JOIN_FADE_SEC): string {
  const lines: string[] = [];
  const labels: string[] = [];
  keeps.forEach((k, n) => {
    const f0 = Math.round(k.start * fps);
    const f1 = Math.round(k.end * fps);
    const s0 = Math.round((f0 / fps) * sampleRate);
    const s1 = Math.round((f1 / fps) * sampleRate);
    const dur = (s1 - s0) / sampleRate;
    const d = Math.min(fade, dur / 2);
    lines.push(`[0:v]trim=start_frame=${f0}:end_frame=${f1},setpts=PTS-STARTPTS[v${n}]`);
    lines.push(
      `[0:a]atrim=start_sample=${s0}:end_sample=${s1},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${d.toFixed(4)},afade=t=out:st=${(dur - d).toFixed(4)}:d=${d.toFixed(4)}[a${n}]`,
    );
    labels.push(`[v${n}][a${n}]`);
  });
  lines.push(`${labels.join("")}concat=n=${keeps.length}:v=1:a=1[v][a]`);
  return lines.join(";\n");
}

export function cutVideo(spec: CutSpec): void {
  const graph = buildCutFilter(spec.keeps, spec.fps, spec.sampleRate);
  // Keep a copy on disk for debugging. The graph goes inline: ffmpeg 7+ dropped
  // -filter_complex_script, and an inline graph works on every version.
  writeFileSync(spec.scriptPath, graph);
  const res = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
      "-i", spec.src,
      "-filter_complex", graph,
      "-map", "[v]", "-map", "[a]",
      "-r", String(spec.fps), "-fps_mode", "cfr",
      "-c:v", "h264_videotoolbox", "-b:v", "24M", "-pix_fmt", "yuv420p", "-tag:v", "avc1",
      "-c:a", "aac", "-b:a", "256k", "-ar", String(spec.sampleRate),
      "-movflags", "+faststart",
      spec.out,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`clean cut failed (exit ${res.status}): ${(res.stderr ?? "").slice(-1500)}`);
}
