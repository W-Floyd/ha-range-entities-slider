#!/usr/bin/env bash
#
# Renders the card in a real Home Assistant and checks it.
#
# Boots Home Assistant in Docker with a seeded config, then runs Playwright in a
# second container on the same network. Nothing is installed on the host beyond
# Docker itself — the browser and library live in the image built from
# tests/Dockerfile.
#
# Usage: tests/render.sh [ha_version]     # default: stable
#
# Env:
#   HA_PORT=8124    host port for poking at the instance yourself
#   KEEP_HA=1       leave Home Assistant running after the test
#   STRICT_THUMBS=0 warn instead of fail if the Material You patch stops applying
#   SWEEP_THEMES=1  also install the custom themes and screenshot the row in each
#   STRICT_THEMES=0 warn instead of fail if a theme leaves the handle unpainted
#
set -euo pipefail

HA_VERSION="${1:-stable}"
HA_IMAGE="ghcr.io/home-assistant/home-assistant:${HA_VERSION}"
RENDER_IMAGE="range-entity-row-render:local"
CONTAINER="range-entity-row-ha"
NETWORK="range-entity-row-render"
PORT="${HA_PORT:-8124}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/tests/screenshots}"

workdir="$(mktemp -d)"
cleanup() {
  if [[ "${KEEP_HA:-0}" == "1" ]]; then
    echo "==> leaving ${CONTAINER} running on http://localhost:${PORT} (user: render / render-password)"
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT

# The seed config is copied out of the repo so Home Assistant's generated
# .storage, logs, and database never touch the working tree.
echo "==> preparing config (${workdir})"
cp -R "$ROOT/tests/ha-config/." "$workdir/"
mkdir -p "$workdir/www" "$workdir/themes" "$OUT_DIR"
cp "$ROOT/ha-range-entities-slider.js" "$workdir/www/"

printf -- '- url: /local/ha-range-entities-slider.js\n  type: module\n' >"$workdir/resources.yaml"

if [[ "${SWEEP_THEMES:-0}" == "1" ]]; then
  "$ROOT/tests/install-themes.sh" "$workdir"
  if [[ -f "$workdir/www/material-you-utilities.min.js" ]]; then
    printf -- '- url: /local/material-you-utilities.min.js\n  type: module\n' >>"$workdir/resources.yaml"
  fi
fi

echo "==> building ${RENDER_IMAGE}"
docker build -q -t "$RENDER_IMAGE" "$ROOT/tests" >/dev/null

echo "==> starting ${HA_IMAGE}"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker network create "$NETWORK" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  --network "$NETWORK" --network-alias ha \
  -p "${PORT}:8123" \
  -v "$workdir:/config" \
  -e TZ=UTC \
  "$HA_IMAGE" >/dev/null

status=0
docker run --rm \
  --network "$NETWORK" \
  --ipc=host \
  -v "$ROOT/tests:/tests:ro" \
  -v "$OUT_DIR:/out" \
  -e HA_URL=http://ha:8123 \
  -e HA_VERSION="$HA_VERSION" \
  -e OUT_DIR=/out \
  -e STRICT_THUMBS="${STRICT_THUMBS:-1}" \
  -e SWEEP_THEMES="${SWEEP_THEMES:-0}" \
  -e STRICT_THEMES="${STRICT_THEMES:-1}" \
  -e THEME_FILTER="${THEME_FILTER:-}" \
  -e ALL_THEMES="${ALL_THEMES:-0}" \
  "$RENDER_IMAGE" node /tests/render.mjs || status=$?

if [[ "$status" != "0" ]]; then
  echo "==> render failed; last Home Assistant log lines:" >&2
  docker logs --tail 40 "$CONTAINER" >&2 || true
fi

exit "$status"
