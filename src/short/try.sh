#!/usr/bin/env bash
# try.sh — friendly one-command wrapper around auto.ts for people who are not
# developers: point it at any talking-head video and it produces a finished
# 1080x1920 short in ~/Movies/jev-shorts/ (override with JEV_OUT_DIR).
#
#   ./src/short/try.sh /path/to/any-video.mp4 [extra auto.ts flags...]
#
# Extra flags (e.g. --workers 8) are forwarded verbatim to auto.ts.
#
# What it does:
#   1. Validates the input file exists and is actually a video (via ffprobe).
#   2. Creates a scratch work dir under the system temp directory.
#   3. Runs auto.ts end-to-end (plan -> film -> render) with --title derived
#      from the input filename.
#   4. Writes the finished mp4 to ~/Movies/jev-shorts/<input-basename>-short.mp4,
#      never overwriting an existing file (adds -2, -3, ... instead).
#   5. Prints the output path, wall-clock time, and the style Jev picked
#      (family / accent / caption style), read back from the work dir's plan.json.
set -euo pipefail

# ---- resolve our own location, independent of the caller's cwd ----
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_PATH" ]; do
  DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  [[ $SCRIPT_PATH != /* ]] && SCRIPT_PATH="$DIR/$SCRIPT_PATH"
done
SHORT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
# try.sh lives at <repo>/src/short/try.sh -> repo root is two levels up.
REPO_DIR="$(cd -P "$SHORT_DIR/../.." >/dev/null 2>&1 && pwd)"

usage() {
  echo "Usage: $(basename "$0") /path/to/any-video.mp4 [extra auto.ts flags...]" >&2
  echo "  e.g.  $(basename "$0") ~/Desktop/take3.mp4 --workers 8" >&2
}

if [ "$#" -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 1
fi

INPUT="$1"
shift
EXTRA_ARGS=("$@")

# ---- validate input ----
if [ ! -f "$INPUT" ]; then
  echo "error: input file not found: $INPUT" >&2
  exit 1
fi
INPUT="$(cd -P "$(dirname "$INPUT")" >/dev/null 2>&1 && pwd)/$(basename "$INPUT")"

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "error: ffprobe not found on PATH — install ffmpeg (e.g. 'brew install ffmpeg') and try again." >&2
  exit 1
fi

if ! ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "$INPUT" 2>/dev/null | grep -q video; then
  echo "error: '$INPUT' doesn't look like a video file (ffprobe found no video stream)." >&2
  exit 1
fi

# ---- work dir under system temp ----
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jev-short.XXXXXX")"

# ---- output path, non-clobbering ----
OUT_DIR="${JEV_OUT_DIR:-$HOME/Movies/jev-shorts}"
mkdir -p "$OUT_DIR"
BASE="$(basename "$INPUT")"
BASE="${BASE%.*}"
OUT_FILE="$OUT_DIR/${BASE}-short.mp4"
if [ -e "$OUT_FILE" ]; then
  n=2
  while [ -e "$OUT_DIR/${BASE}-short-$n.mp4" ]; do
    n=$((n + 1))
  done
  OUT_FILE="$OUT_DIR/${BASE}-short-$n.mp4"
fi

# ---- title derived from the input filename ----
TITLE="$(echo "$BASE" | tr '_-' '  ')"

echo "input:  $INPUT"
echo "work:   $WORK_DIR"
echo "output: $OUT_FILE"
echo "title:  $TITLE"
echo ""

START_TS=$(date +%s)

# Run from the repo root so npx finds the local tsx in node_modules/.bin.
cd "$REPO_DIR"
if [ ! -x node_modules/.bin/tsx ]; then
  echo "error: dependencies are not installed. Run 'npm install' in $REPO_DIR first." >&2
  exit 1
fi
set +e
npx tsx src/short/auto.ts \
  --in "$INPUT" \
  --out "$OUT_FILE" \
  --work "$WORK_DIR" \
  --title "$TITLE" \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
STATUS=$?
set -e

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

if [ "$STATUS" -ne 0 ]; then
  echo "" >&2
  echo "error: auto.ts failed (exit $STATUS). Work dir kept for inspection: $WORK_DIR" >&2
  exit "$STATUS"
fi

if [ ! -f "$OUT_FILE" ]; then
  echo "error: auto.ts reported success but $OUT_FILE was not created." >&2
  exit 1
fi

# ---- pull the style Jev picked out of plan.json for the summary ----
STYLE_SUMMARY="(plan.json not found — could not read style)"
PLAN_JSON="$WORK_DIR/plan.json"
if [ -f "$PLAN_JSON" ]; then
  STYLE_SUMMARY="$(node -e '
    const fs = require("fs");
    const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const s = plan.style || {};
    console.log(`family=${s.family ?? "?"} accent=${s.accent ?? "?"} captionStyle=${s.captionStyle ?? "?"}`);
  ' "$PLAN_JSON" 2>/dev/null || echo "(could not parse plan.json)")"
fi

echo ""
echo "======================================================================"
echo "done."
echo "output:     $OUT_FILE"
echo "wall clock: ${ELAPSED}s"
echo "style:      $STYLE_SUMMARY"
echo "======================================================================"
