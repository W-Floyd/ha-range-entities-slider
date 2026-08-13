#!/usr/bin/env bash
#
# Builds src/ into the single file Home Assistant loads, with Lit bundled in.
#
# Runs in a container so Docker stays the only thing this repository needs
# installed, the same as the render test. Set LOCAL_NODE=1 to use the host's
# node and npm instead.
#
# Usage: tools/build.sh [--check]
#
#   --check  build to a temp file and fail if it differs from the committed one,
#            which is what stops the two drifting apart
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# custom-card-helpers asks for node >= 24.
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"
OUT="ha-range-entities-slider.js"

run() {
  if [[ "${LOCAL_NODE:-0}" == "1" ]]; then
    (cd "$ROOT" && "$@")
  else
    docker run --rm \
      -v "$ROOT:/repo" \
      -w /repo \
      -e npm_config_update_notifier=false \
      "$NODE_IMAGE" "$@"
  fi
}

install_deps() {
  if [[ -f "$ROOT/package-lock.json" ]]; then
    run npm ci --no-audit --no-fund
  else
    run npm install --no-audit --no-fund
  fi
}

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "==> installing dependencies"
  install_deps
fi

if [[ "${1:-}" == "--check" ]]; then
  echo "==> checking ${OUT} matches src/"
  before="$(shasum -a 256 "$ROOT/$OUT" | cut -d" " -f1)"
  run npm run --silent build
  after="$(shasum -a 256 "$ROOT/$OUT" | cut -d" " -f1)"
  if [[ "$before" != "$after" ]]; then
    echo "error: ${OUT} is not what src/ builds; run 'just build' and commit it" >&2
    exit 1
  fi
  echo "ok: ${OUT} matches src/"
  exit 0
fi

echo "==> typechecking"
run npm run --silent typecheck

echo "==> building ${OUT}"
run npm run --silent build
echo "ok: $(wc -c <"$ROOT/$OUT" | tr -d ' ') bytes"
