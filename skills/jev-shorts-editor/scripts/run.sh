#!/usr/bin/env bash
# run.sh - makes a 1080x1920 short from a talking-head clip and opens the live preview
# as soon as the edit is planned, while the MP4 export continues.
#
#   run.sh <clip> [--out-dir DIR] [--no-open] [--preview-only] [extra auto.ts flags...]
#
#   --out-dir DIR    where the MP4 and its work folder go (default ~/Movies/jev-shorts,
#                    or $JEV_OUT_DIR)
#   --no-open        don't open the preview in the browser
#   --preview-only   plan the edit and build the preview, skip the MP4 export (about 15 s)
#   extra flags      passed to auto.ts as-is, e.g. --no-clean, --workers 8, --title "..."
#
# Prints, at the end, lines an agent can parse:
#   output: <mp4>   work: <dir>   preview: <html>   log: <file>   seconds: <n>   style: ...
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ "$#" -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
fi

INPUT="$1"; shift
OUT_DIR="${JEV_OUT_DIR:-$HOME/Movies/jev-shorts}"
OPEN=1
EXTRA=()
HAS_TITLE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --no-open) OPEN=0; shift ;;
    --preview-only) EXTRA+=(--no-export); shift ;;
    --title) HAS_TITLE=1; EXTRA+=("$1" "$2"); shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

if [ ! -f "$INPUT" ]; then echo "error: clip not found: $INPUT" >&2; exit 1; fi
INPUT="$(cd -P "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
if ! ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "$INPUT" 2>/dev/null | grep -q video; then
  echo "error: no video stream in $INPUT" >&2; exit 1
fi

REPO="$(repo_or_die)" || exit 3
if [ ! -x "$REPO/node_modules/.bin/tsx" ]; then
  echo "error: dependencies missing. Run: cd \"$REPO\" && npm install" >&2; exit 1
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd -P "$OUT_DIR" && pwd)"
BASE="$(basename "$INPUT")"; BASE="${BASE%.*}"
STEM="${BASE}-short"; n=2
while [ -e "$OUT_DIR/$STEM.mp4" ] || [ -e "$OUT_DIR/$STEM-work" ]; do STEM="${BASE}-short-$n"; n=$((n + 1)); done
OUT="$OUT_DIR/$STEM.mp4"
WORK="$OUT_DIR/$STEM-work"
PREVIEW="$WORK/preview.html"
LOG="$WORK/run.log"
mkdir -p "$WORK"
[ "$HAS_TITLE" -eq 0 ] && EXTRA+=(--title "$(echo "$BASE" | tr '_-' '  ')")

echo "input:   $INPUT"
echo "repo:    $REPO"
echo "work:    $WORK"
echo "log:     $LOG"
echo

START=$(date +%s)
(cd "$REPO" && exec node_modules/.bin/tsx src/short/auto.ts --in "$INPUT" --out "$OUT" --work "$WORK" --preview "$PREVIEW" ${EXTRA[@]+"${EXTRA[@]}"}) >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null' INT TERM

opened=0
last=""
while kill -0 "$PID" 2>/dev/null; do
  if [ "$opened" -eq 0 ] && [ -f "$PREVIEW" ]; then
    echo "preview ready after $(( $(date +%s) - START )) s: $PREVIEW"
    [ "$OPEN" -eq 1 ] && open "$PREVIEW"
    opened=1
  fi
  line="$(grep -v '^\s*$' "$LOG" 2>/dev/null | tail -n 1)"
  if [ -n "$line" ] && [ "$line" != "$last" ]; then echo "  $line"; last="$line"; fi
  sleep 2
done
wait "$PID"; STATUS=$?
SECS=$(( $(date +%s) - START ))

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "FAILED (exit $STATUS) after ${SECS}s. Last lines of the log:" >&2
  tail -n 25 "$LOG" >&2
  echo "work: $WORK"
  echo "log: $LOG"
  exit "$STATUS"
fi
if [ "$opened" -eq 0 ] && [ -f "$PREVIEW" ] && [ "$OPEN" -eq 1 ]; then open "$PREVIEW"; fi

STYLE="$(node -e '
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = p.style || {};
  const shots = (p.shots || p.beats || []).length;
  const src = p.source && p.source.durationSec ? p.source.durationSec.toFixed(1) + "s" : "?";
  console.log(`family=${s.family} accent=${s.accent} captions=${s.captionStyle} shots=${shots} source=${src}`);
' "$WORK/plan.json" 2>/dev/null || echo "?")"

echo
echo "done."
if [ -f "$OUT" ]; then
  echo "output: $OUT"
  echo "length: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | xargs printf '%.1f')s"
else
  echo "output: (not exported; --preview-only)"
fi
echo "work: $WORK"
echo "preview: $PREVIEW"
echo "log: $LOG"
echo "seconds: $SECS"
echo "style: $STYLE"
