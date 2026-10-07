/**
 * Stage 1b: extract 1 frame/sec, detect faces (Apple Vision via a compiled
 * Swift CLI) and get one Groq vision-LLM scene description, concurrently.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getGroqKey } from "./groqEnv";

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Perception {
  face: FaceBox;
  facePerSecond: (FaceBox | null)[];
  description: string;
  /** framesWithFace / framesSampled across the 1fps sampled frames (0 if none sampled). */
  faceConfidence: number;
  /** faceConfidence at/above FACE_RELIABILITY_THRESHOLD. When false, `face` is a neutral
   *  placeholder (NOT a detection) — downstream callers must not anchor on it or assert a
   *  speaker is present. See summarizeFaces() below. */
  hasReliableFace: boolean;
}

function extractFrames(srcPath: string, workDir: string): string {
  const framesDir = join(workDir, "pframes");
  mkdirSync(framesDir, { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-y", "-i", srcPath, "-vf", "fps=1,scale=540:-1", "-q:v", "3", join(framesDir, "f%04d.jpg")],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return framesDir;
}

/** Compile faces.swift once into <repo>/bin/faces, skipping if the binary is newer than the source. */
function ensureFacesBinary(workDir: string): string {
  const srcSwift = resolve(import.meta.dirname, "perceive", "faces.swift");
  const binDir = resolve(import.meta.dirname, "..", "..", "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "faces");
  const needsCompile = !existsSync(binPath) || statSync(binPath).mtimeMs < statSync(srcSwift).mtimeMs;
  if (needsCompile) {
    execFileSync("swiftc", ["-O", srcSwift, "-o", binPath], { stdio: ["ignore", "pipe", "pipe"] });
  }
  return binPath;
}

interface FrameFaceResult {
  file: string;
  faces: FaceBox[];
}

function runFaceDetection(workDir: string, framesDir: string): FrameFaceResult[] {
  const bin = ensureFacesBinary(workDir);
  const out = execFileSync(bin, [framesDir], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out) as FrameFaceResult[];
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medianBox(boxes: FaceBox[]): FaceBox {
  return {
    x: median(boxes.map(b => b.x)),
    y: median(boxes.map(b => b.y)),
    w: median(boxes.map(b => b.w)),
    h: median(boxes.map(b => b.h)),
  };
}

/**
 * DEFECT 1 fix: fraction of sampled seconds (1fps) that contain at least one detected face.
 * A video that only ever shows a face in a handful of sampled seconds (a fleeting glance,
 * a driver visible for one frame at an intersection, a single reflection) is not evidence of
 * a "talking-head" video and must not be framed or described as one downstream. 0.3 is chosen
 * as a defensible floor: it requires a face in roughly a third of the sampled timeline (so a
 * brief cameo or a false-positive blip can't flip this true), while still tolerating a real
 * speaker who glances off-camera, is briefly occluded, or shares frame time with b-roll/screen
 * content — i.e. it does not require near-constant presence, only a recurring, verified subject.
 */
const FACE_RELIABILITY_THRESHOLD = 0.3;

/** Largest face per frame (by area), median across frames -> facePerSecond + overall median face. */
export function summarizeFaces(
  perFrame: FrameFaceResult[],
): { face: FaceBox; facePerSecond: (FaceBox | null)[]; faceConfidence: number; hasReliableFace: boolean } {
  const facePerSecond: (FaceBox | null)[] = perFrame.map(fr => {
    if (fr.faces.length === 0) return null;
    let largest = fr.faces[0];
    let largestArea = largest.w * largest.h;
    for (const f of fr.faces) {
      const a = f.w * f.h;
      if (a > largestArea) {
        largest = f;
        largestArea = a;
      }
    }
    return largest;
  });
  const present = facePerSecond.filter((b): b is FaceBox => b !== null);
  const faceConfidence = facePerSecond.length > 0 ? present.length / facePerSecond.length : 0;
  const hasReliableFace = faceConfidence >= FACE_RELIABILITY_THRESHOLD;
  // Neutral placeholder box for callers that still need *a* box shape even when unreliable —
  // NOT a detection. Callers must gate on hasReliableFace before treating `face` as real.
  const face = present.length > 0 ? medianBox(present) : { x: 0.3, y: 0.1, w: 0.4, h: 0.4 };
  return { face, facePerSecond, faceConfidence, hasReliableFace };
}

/** Purely positional fact derived from the actual median face box — no claims about who/what
 *  is in frame, the background, or whether other content (screens, b-roll) exists. */
export function describeFacePosition(face: FaceBox): string {
  const vertical = face.y < 0.2 ? "upper" : face.y + face.h > 0.7 ? "lower" : "upper-middle";
  const cx = face.x + face.w / 2;
  const horizontal = cx < 0.4 ? "left" : cx > 0.6 ? "right" : "center";
  return `A face is detected in the ${vertical} ${horizontal} of the frame (median across sampled frames).`;
}

/**
 * DEFECT 4 fix: compose the final description from only what was actually observed.
 * - Groq's vision description, when available, is trusted as-is (it looked at real frames);
 *   we no longer staple a possibly-contradictory synthesized sentence onto it.
 * - A purely positional face fact is appended only when the face signal is reliable, since
 *   that's the only face claim the numbers actually support.
 * - When there's no reliable face AND no Groq description, we say so honestly instead of
 *   inventing a "single speaker talking to camera" scene that may not exist.
 */
export function composeDescription(
  groqDescription: string | null,
  face: FaceBox,
  hasReliableFace: boolean,
  framesWithFace: number,
  framesSampled: number,
): string {
  if (hasReliableFace) {
    const positionFact = describeFacePosition(face);
    return groqDescription ? `${groqDescription.trim().replace(/\s+$/, "")} ${positionFact}` : positionFact;
  }
  if (groqDescription) return groqDescription.trim();
  return framesSampled > 0
    ? `No reliable face detected (present in ${framesWithFace}/${framesSampled} sampled frames); scene content could not be automatically described.`
    : `No frames were sampled; scene content could not be automatically described.`;
}

interface GroqModel {
  id: string;
  input_modalities?: string[];
  output_modalities?: string[];
  created?: number;
}

async function pickVisionModel(): Promise<string[]> {
  const key = getGroqKey();
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return [];
  const data = (await res.json()) as { data: GroqModel[] };
  const candidates = data.data.filter(
    m => (m.input_modalities ?? []).includes("image") && (m.output_modalities ?? []).includes("text"),
  );
  // prefer llama-4 scout/maverick if present, then newest first
  candidates.sort((a, b) => {
    const aScore = /llama-4|scout|maverick/i.test(a.id) ? 1 : 0;
    const bScore = /llama-4|scout|maverick/i.test(b.id) ? 1 : 0;
    if (aScore !== bScore) return bScore - aScore;
    return (b.created ?? 0) - (a.created ?? 0);
  });
  return candidates.map(c => c.id);
}

function pickSampleFrames(framesDir: string): string[] {
  const files = readdirSync(framesDir)
    .filter(f => f.endsWith(".jpg"))
    .sort();
  if (files.length === 0) return [];
  const start = files[0];
  const mid = files[Math.floor(files.length / 2)];
  const end = files[files.length - 1];
  return [...new Set([start, mid, end])].map(f => join(framesDir, f));
}

async function describeWithGroq(framesDir: string): Promise<string | null> {
  const models = await pickVisionModel();
  if (models.length === 0) return null;
  const samplePaths = pickSampleFrames(framesDir);
  if (samplePaths.length === 0) return null;
  const images = samplePaths.map(p => readFileSync(p).toString("base64"));

  const prompt =
    "These are 3 frames (start, middle, end) sampled from a video clip of unknown content. " +
    "In 2-3 sentences, factually describe what is actually visible: the shot type/framing and orientation " +
    "(vertical/horizontal/square, if apparent), the subject(s) or content on screen (a person, multiple people, " +
    "a screen recording, text/UI, an object, an animal, a landscape, etc. — whatever is actually there), the " +
    "setting or background, and anything else visible (on-screen text, monitors, props). Also note lighting/mood " +
    "briefly. Be concrete and literal, no speculation — do not assume this is a talking-head video, that there is " +
    "a single speaker, or that anyone is present unless you can actually see it in the frames.";

  const content: unknown[] = [{ type: "text", text: prompt }];
  for (const b64 of images) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }

  const key = getGroqKey();
  for (const model of models.slice(0, 2)) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content }],
          temperature: 0.3,
          max_tokens: 220,
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      // try next model
    }
  }
  return null;
}

export async function perceive(srcPath: string, workDir: string): Promise<Perception> {
  const framesDir = extractFrames(srcPath, workDir);

  const [perFrame, groqDescription] = await Promise.all([
    Promise.resolve().then(() => runFaceDetection(workDir, framesDir)),
    describeWithGroq(framesDir).catch(() => null),
  ]);

  const { face, facePerSecond, faceConfidence, hasReliableFace } = summarizeFaces(perFrame);
  const framesWithFace = facePerSecond.filter(b => b !== null).length;
  const description = composeDescription(groqDescription, face, hasReliableFace, framesWithFace, facePerSecond.length);

  const perception: Perception = { face, facePerSecond, description, faceConfidence, hasReliableFace };
  writeFileSync(join(workDir, "perception.json"), JSON.stringify(perception, null, 2));
  return perception;
}
