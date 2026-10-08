#!/usr/bin/env bash
# verify.sh - re-transcribes a finished short and reports retakes left in, caption
# drift, long pauses and format problems, plus a one-frame-per-second contact sheet.
#
#   verify.sh <short.mp4> [<work dir>]
#
# The work dir defaults to <short>-work next to the MP4 (what run.sh creates).
# Writes report.md, report.json and sheet.png into <work dir>/verify and prints report.md.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
if [ "$#" -lt 1 ]; then sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; fi
VIDEO="$(cd -P "$(dirname "$1")" && pwd)/$(basename "$1")"
WORK="${2:-${VIDEO%.mp4}-work}"
REPO="$(repo_or_die)" || exit 3
ARGS=(--video "$VIDEO")
if [ -d "$WORK" ]; then ARGS+=(--work "$(cd -P "$WORK" && pwd)"); fi
cd "$REPO" && exec node_modules/.bin/tsx src/short/verify.ts "${ARGS[@]}"
