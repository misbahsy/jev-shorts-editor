#!/usr/bin/env bash
# doctor.sh - checks everything jev-shorts-editor needs and prints the fix for each gap.
# Exit 0 when the machine is ready, 1 when something is missing, 3 when no checkout exists.
# Key checks print only "set" or "missing"; no key value is ever read into this script.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

missing=0
ok()   { printf '  ok       %s\n' "$1"; }
miss() { printf '  MISSING  %s\n           fix: %s\n' "$1" "$2"; missing=1; }

echo "jev-shorts-editor doctor"
echo

if [ "$(uname -s)" != "Darwin" ]; then
  miss "macOS (this tool uses Apple WebKit, Vision and MLX)" "run it on a Mac with Apple silicon"
else
  ver="$(sw_vers -productVersion)"; major="${ver%%.*}"
  if [ "$(uname -m)" = "arm64" ] && [ "$major" -ge 15 ]; then ok "macOS $ver on Apple silicon"
  else miss "macOS 15+ on Apple silicon (found $ver on $(uname -m))" "use an Apple silicon Mac on macOS 15 or later"; fi
fi

if command -v swiftc >/dev/null 2>&1; then ok "swiftc (compiles the renderer and face tracker on first run)"
else miss "swiftc" "xcode-select --install   (opens an Apple installer the user clicks through)"; fi

if command -v node >/dev/null 2>&1; then
  nv="$(node -p 'process.versions.node')"
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)'; then ok "node $nv"
  else miss "node 20.11+ (found $nv)" "brew install node"; fi
else miss "node 20.11+" "brew install node"; fi

for t in ffmpeg ffprobe; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t"; else miss "$t" "brew install ffmpeg"; fi
done

if command -v uv >/dev/null 2>&1; then ok "uv"; else miss "uv (installs the speech model tool)" "brew install uv"; fi

if [ -n "${PARAKEET_BIN:-}" ] && [ -x "${PARAKEET_BIN}" ] || command -v parakeet-mlx >/dev/null 2>&1 || [ -x "$HOME/.local/bin/parakeet-mlx" ]; then
  ok "parakeet-mlx (on-device transcription)"
else miss "parakeet-mlx (on-device transcription)" "uv tool install parakeet-mlx"; fi

echo
if repo="$(find_repo)"; then
  ok "checkout at $repo"
  if [ -x "$repo/node_modules/.bin/tsx" ]; then ok "npm dependencies"
  else miss "npm dependencies" "cd \"$repo\" && npm install"; fi

  if [ -x "$repo/node_modules/.bin/tsx" ]; then
    keys="$(cd "$repo" && node_modules/.bin/tsx --eval '
      import { optionalEnv } from "./src/env.ts";
      const has = (k) => Boolean(optionalEnv(k));
      const jev = has("TYPESAFE_API_KEY") || (has("LITELLM_BASE_URL") && has("LITELLM_API_KEY"));
      console.log(`jev=${jev ? "set" : "missing"} groq=${has("GROQ_API_KEY") ? "set" : "missing"}`);
    ' 2>/dev/null)"
    case "$keys" in
      *jev=set*) ok "Jev access (TYPESAFE_API_KEY, or LITELLM_BASE_URL + LITELLM_API_KEY)" ;;
      *) miss "Jev access (TYPESAFE_API_KEY, or LITELLM_BASE_URL + LITELLM_API_KEY)" "copy .env.example to .env in the checkout and paste the key there" ;;
    esac
    case "$keys" in
      *groq=set*) ok "GROQ_API_KEY (writes hook and card copy)" ;;
      *) miss "GROQ_API_KEY (writes hook and card copy)" "add GROQ_API_KEY to .env in the checkout" ;;
    esac
  fi
else
  miss "a jev-shorts-editor checkout" "git clone https://github.com/misbahsy/jev-shorts-editor.git ~/jev-shorts-editor && cd ~/jev-shorts-editor && npm install"
fi

echo
if [ "$missing" -eq 0 ]; then echo "ready."; else echo "not ready: fix the MISSING lines above, then run doctor again."; fi
exit "$missing"
