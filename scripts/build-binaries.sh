#!/usr/bin/env bash
# Compile notesage-acp-pi into self-contained platform binaries (task #12).
# Same technique pi itself uses: `bun build --compile`. Produces
#   dist/notesage-acp-pi-<triple>.tar.gz  (single executable at tar root)
#   dist/SHA256SUMS
# Usage: scripts/build-binaries.sh [target ...]
#   Default targets: all four release platforms. Pass a single Bun target
#   (e.g. bun-linux-x64) for a local smoke build.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
command -v bun >/dev/null || { echo "ERROR: bun is required (used only at build time)"; exit 1; }

# Bun target → release-asset triple (matches the Rust-triple naming used for
# Goose/pi assets so agent_manager.rs asset resolution stays uniform).
#
# A `case` rather than an associative array: `declare -A` needs bash 4+, and
# macOS still ships bash 3.2, so the array version could only ever run in CI —
# leaving no way to build or verify a release locally on the platform this is
# primarily developed on.
triple_for() {
  case "$1" in
    bun-darwin-arm64) echo "aarch64-apple-darwin" ;;
    bun-darwin-x64)   echo "x86_64-apple-darwin" ;;
    bun-linux-x64)    echo "x86_64-unknown-linux-gnu" ;;
    bun-linux-arm64)  echo "aarch64-unknown-linux-gnu" ;;
    *) return 1 ;;
  esac
}

TARGETS=("$@")
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64)

rm -rf dist && mkdir -p dist
for target in "${TARGETS[@]}"; do
  triple="$(triple_for "$target")" || { echo "ERROR: unknown target $target"; exit 1; }
  out="dist/notesage-acp-pi-$triple"
  echo "== $target → $out"
  bun build --compile --target="$target" src/index.ts --outfile "$out"
  tar -C dist -czf "$out.tar.gz" "notesage-acp-pi-$triple"
  rm -f "$out"
done

# Scoped checksum asset name. Originally scoped because these assets landed on
# the shared Notesage app release; they now ship on this repo's own releases,
# but the name is kept because it is a wire contract — Notesage's
# `agent_manager.rs` verifies against this exact filename.
SUMS="notesage-acp-pi-SHA256SUMS"
(cd dist && shasum -a 256 ./*.tar.gz | sed 's|\./||' > "$SUMS") 2>/dev/null \
  || (cd dist && sha256sum ./*.tar.gz | sed 's|\./||' > "$SUMS")
echo "== dist/:" && ls -la dist && cat "dist/$SUMS"
