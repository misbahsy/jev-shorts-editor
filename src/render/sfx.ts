// Resolve SFX assets by type. Prefers the bundled assets in assets/sfx (from
// HyperFrames, Apache-2.0, see NOTICE); synthesizes with ffmpeg lavfi
// filters as a fallback when a type isn't available there.

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SFX_TYPES = ["whoosh", "pop", "ding", "riser", "impact"] as const;
export type SfxType = (typeof SFX_TYPES)[number];

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENDOR_SFX_DIR = path.join(REPO_ROOT, "assets", "sfx");

// Best-fit mapping from plan.json sfx "type" to an existing vendor asset filename.
const VENDOR_MAP: Record<SfxType, string> = {
  whoosh: "whoosh.mp3",
  pop: "pop.mp3",
  ding: "chime.mp3",
  riser: "riser.mp3",
  impact: "impact-bass-1.mp3",
};

function run(args: string[]) {
  const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  if (res.status !== 0) {
    throw new Error(`ffmpeg synth failed (${args.join(" ")}): ${res.stderr?.toString().slice(-1000)}`);
  }
}

function synth(type: SfxType, outPath: string) {
  const sr = 48000;
  switch (type) {
    case "whoosh":
      run([
        "-y", "-f", "lavfi", "-i", `anoisesrc=color=pink:duration=0.5:sample_rate=${sr}`,
        "-af", "bandpass=f=1200:width_type=o:w=2.2,afade=t=in:d=0.08,afade=t=out:st=0.3:d=0.2,volume=-14dB",
        outPath,
      ]);
      break;
    case "riser":
      run([
        "-y", "-f", "lavfi", "-i",
        `aevalsrc=0.35*sin(2*PI*(150*t+500*t*t)):duration=1.2:sample_rate=${sr}`,
        "-af", "afade=t=in:d=0.15,afade=t=out:st=0.9:d=0.3,volume=-14dB",
        outPath,
      ]);
      break;
    case "pop":
      run([
        "-y", "-f", "lavfi", "-i", `sine=frequency=280:duration=0.12:sample_rate=${sr}`,
        "-af", "afade=t=out:st=0:d=0.12:curve=exp,volume=-14dB",
        outPath,
      ]);
      break;
    case "ding":
      run([
        "-y", "-f", "lavfi", "-i", `sine=frequency=1500:duration=0.5:sample_rate=${sr}`,
        "-af", "afade=t=out:st=0.05:d=0.45:curve=exp,volume=-14dB",
        outPath,
      ]);
      break;
    case "impact":
      run([
        "-y", "-f", "lavfi", "-i", `sine=frequency=70:duration=0.35:sample_rate=${sr}`,
        "-af", "afade=t=out:st=0:d=0.35:curve=exp,volume=-14dB",
        outPath,
      ]);
      break;
  }
}

/** Returns absolute file paths for each sfx type, preferring vendor assets, synthesizing into scratchDir otherwise. */
export function resolveSfxAssets(scratchDir: string, onStatus?: (msg: string) => void): Record<SfxType, string> {
  mkdirSync(scratchDir, { recursive: true });
  const out = {} as Record<SfxType, string>;
  for (const type of SFX_TYPES) {
    const vendorPath = path.join(VENDOR_SFX_DIR, VENDOR_MAP[type]);
    if (existsSync(vendorPath)) {
      out[type] = vendorPath;
      onStatus?.(`sfx[${type}] -> vendor asset ${vendorPath}`);
      continue;
    }
    const synthPath = path.join(scratchDir, `${type}.wav`);
    synth(type, synthPath);
    out[type] = synthPath;
    onStatus?.(`sfx[${type}] -> synthesized ${synthPath}`);
  }
  return out;
}

if (require.main === module) {
  const scratch = process.argv[2] || path.join(REPO_ROOT, ".sfx-test");
  const assets = resolveSfxAssets(scratch, (m) => console.error(m));
  console.log(JSON.stringify(assets, null, 2));
}
