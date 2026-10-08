#!/usr/bin/env bash
# keys.sh - creates the checkout's key file from the example (if it doesn't exist yet)
# and opens it in TextEdit so the user can paste their keys. Never prints key values.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
REPO="$(repo_or_die)" || exit 3
F="$REPO/.env"
if [ ! -f "$F" ]; then cp "$REPO/.env.example" "$F" && echo "created $F from the example"; fi
chmod 600 "$F"
open -e "$F"
echo "opened $F in TextEdit. Paste the keys after the = signs, save, and close it."
echo "then run doctor.sh again to confirm they are picked up."
