# lib.sh - shared helpers for the jev-shorts-editor skill scripts. Source it, don't run it.
#
# find_repo prints the path of a jev-shorts-editor checkout, or returns 1. It looks, in order, at:
#   1. $JEV_REPO
#   2. the current directory (if it is a checkout)
#   3. ~/jev-shorts-editor
#   4. the checkout this skill folder lives in, unless the skill was installed as a plugin
#      (the plugin cache is replaced on every update, which would wipe .env, node_modules and bin)

is_checkout() {
  [ -f "$1/package.json" ] && [ -f "$1/src/short/auto.ts" ] && grep -q '"name": "jev-shorts-editor"' "$1/package.json" 2>/dev/null
}

skill_dir() {
  cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd
}

find_repo() {
  local c
  for c in "${JEV_REPO:-}" "$PWD" "$HOME/jev-shorts-editor"; do
    if [ -n "$c" ] && is_checkout "$c"; then (cd -P "$c" && pwd); return 0; fi
  done
  c="$(cd -P "$(skill_dir)/../.." >/dev/null 2>&1 && pwd)"
  case "$c" in
    "$HOME/.claude/plugins"*) ;;
    *) if is_checkout "$c"; then echo "$c"; return 0; fi ;;
  esac
  return 1
}

repo_or_die() {
  local r
  if ! r="$(find_repo)"; then
    echo "error: no jev-shorts-editor checkout found." >&2
    echo "  fix: git clone https://github.com/misbahsy/jev-shorts-editor.git ~/jev-shorts-editor && (cd ~/jev-shorts-editor && npm install)" >&2
    echo "  or set JEV_REPO to an existing checkout." >&2
    exit 3
  fi
  echo "$r"
}
