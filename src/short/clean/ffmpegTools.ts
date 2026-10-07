/** Audio analysis through ffmpeg: loudness envelope, silence intervals, loudnorm measurement. */
import { spawnSync } from "node:child_process";
import type { Interval, LoudnormMeasure } from "./types";

function runCapture(args: string[], label: string): { stdout: string; stderr: string } {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status}): ${(res.stderr ?? "").slice(-1500)}`);
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

/** RMS level in dBFS for every 10 ms of the first audio stream. */
export function loudnessEnvelope(src: string): number[] {
  const { stdout } = runCapture(
    [
      "-loglevel", "error", "-i", src, "-vn", "-map", "0:a:0",
      "-af", "aresample=16000,asetnsamples=n=160:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null", "-",
    ],
    "loudness envelope",
  );
  const out: number[] = [];
  for (const line of stdout.split("\n")) {
    const m = /RMS_level=(\S+)/.exec(line);
    if (!m) continue;
    const v = m[1] === "-inf" ? -90 : Number(m[1]);
    out.push(Number.isFinite(v) ? Math.max(-90, v) : -90);
  }
  return out;
}

/**
 * Silence threshold chosen from this clip's own levels rather than a fixed number: a quarter of
 * the way from the room-noise floor (10th percentile of 10 ms levels) up to the speech level
 * (90th percentile). A quiet studio and a noisy kitchen get different thresholds.
 */
export function adaptiveSilenceDb(envelope: number[]): { thresholdDb: number; floorDb: number; speechDb: number } {
  if (envelope.length === 0) return { thresholdDb: -40, floorDb: -90, speechDb: -20 };
  const sorted = [...envelope].sort((a, b) => a - b);
  const floorDb = percentile(sorted, 0.1);
  const speechDb = percentile(sorted, 0.9);
  const thresholdDb = Math.min(-30, Math.max(-60, floorDb + 0.25 * (speechDb - floorDb)));
  return { thresholdDb, floorDb, speechDb };
}

/** Quiet stretches at least minDur long, as ffmpeg silencedetect reports them. */
export function detectSilence(src: string, thresholdDb: number, minDur: number, totalSec: number): Interval[] {
  const { stderr } = runCapture(
    [
      "-i", src, "-vn", "-map", "0:a:0",
      "-af", `silencedetect=noise=${thresholdDb.toFixed(1)}dB:d=${minDur}`,
      "-f", "null", "-",
    ],
    "silencedetect",
  );
  return parseSilence(stderr, totalSec);
}

export function parseSilence(log: string, totalSec: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const line of log.split("\n")) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && open !== null) {
      out.push({ start: open, end: Math.min(totalSec, Number(e[1])) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: totalSec });
  return out.filter(i => i.end > i.start);
}

export const LOUDNESS_TARGET_I = -14;
export const LOUDNESS_TARGET_TP = -1;
export const LOUDNESS_TARGET_LRA = 11;
export const HIGHPASS_HZ = 80;

/** First loudnorm pass on the audio of `src`, after the same highpass the final render uses. */
export function measureLoudnorm(src: string): LoudnormMeasure {
  const { stderr } = runCapture(
    [
      "-i", src, "-vn", "-map", "0:a:0",
      "-af", `highpass=f=${HIGHPASS_HZ},loudnorm=I=${LOUDNESS_TARGET_I}:TP=${LOUDNESS_TARGET_TP}:LRA=${LOUDNESS_TARGET_LRA}:print_format=json`,
      "-f", "null", "-",
    ],
    "loudnorm measure",
  );
  return parseLoudnorm(stderr);
}

export function parseLoudnorm(log: string): LoudnormMeasure {
  const start = log.lastIndexOf("{");
  const end = log.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm printed no measurement");
  const j = JSON.parse(log.slice(start, end + 1)) as Record<string, string>;
  const num = (k: string) => {
    const v = Number(j[k]);
    if (!Number.isFinite(v)) throw new Error(`loudnorm measurement is missing ${k}`);
    return v;
  };
  return {
    inputI: num("input_i"),
    inputTP: num("input_tp"),
    inputLRA: num("input_lra"),
    inputThresh: num("input_thresh"),
    targetOffset: num("target_offset"),
  };
}

/** Integrated loudness and true peak of a finished file, for reporting. */
export function measureEbur128(src: string): { integratedLufs: number; truePeakDb: number } {
  const { stderr } = runCapture(
    ["-i", src, "-vn", "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"],
    "ebur128",
  );
  const tail = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = /I:\s+(-?[\d.]+)\s+LUFS/.exec(tail);
  const tp = /Peak:\s+(-?[\d.]+)\s+dBFS/.exec(tail);
  if (!i || !tp) throw new Error("could not read the ebur128 summary");
  return { integratedLufs: Number(i[1]), truePeakDb: Number(tp[1]) };
}
