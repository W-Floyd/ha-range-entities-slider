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
#   FORCE_RENDER=1  render even when nothing has changed since the last run
#
# Pass --fingerprint to print the identity of this run (the card, the tests, the
# sweep settings, and the remote digest of the Home Assistant image) and exit.
# A run whose fingerprint matches the last successful one is skipped.
#
set -euo pipefail

fingerprint_only=0
if [[ "${1:-}" == "--fingerprint" ]]; then
  fingerprint_only=1
  shift
fi

HA_VERSION="${1:-stable}"
HA_IMAGE="ghcr.io/home-assistant/home-assistant:${HA_VERSION}"
RENDER_IMAGE="range-entity-row-render:local"
CONTAINER="range-entity-row-ha"
NETWORK="range-entity-row-render"
PORT="${HA_PORT:-8124}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/tests/screenshots}"

stamp_dir="${RENDER_CACHE:-$ROOT/tests/.render-cache}"

# The card is built from src/ and not committed. Building is deferred until a
# render is actually going to happen: --fingerprint has to print one line and
# nothing else, and the fingerprint is taken from the sources anyway.
build_card() {
  if [[ ! -f "$ROOT/ha-range-entities-slider.js" ]] ||
    [[ -n "$(find "$ROOT/src" -newer "$ROOT/ha-range-entities-slider.js" -type f -print -quit 2>/dev/null)" ]]; then
    "$ROOT/tools/build.sh"
  fi
}

# Resolve the theme commits once and reuse that list for the fingerprint, the
# install and the stamp. Resolving per consumer left a window in which a pack
# could move between them, so the run would render one version and record
# another. A caller (CI, which needs them for its cache key) can pass its own
# list in through THEME_PINS.
theme_pins="${THEME_PINS:-}"
if [[ "${SWEEP_THEMES:-0}" == "1" && -z "$theme_pins" ]]; then
  theme_pins="$(mktemp)"
  own_pins=1
  "$ROOT/tests/install-themes.sh" --versions >"$theme_pins"
fi
export THEME_PINS="$theme_pins"

# What the card's runtime imports currently resolve to. It loads Lit from unpkg
# with a floating major (lit@2 -> lit@2.8.0 today), so a Lit release changes what
# the browser executes without a byte of this repo changing. Resolving the
# redirect makes that visible to the fingerprint.
cdn_imports() {
  local url effective
  while read -r url; do
    if effective="$(curl -sIL --max-time 20 -o /dev/null -w '%{url_effective}' "$url")" &&
      [[ -n "$effective" ]]; then
      echo "${url} -> ${effective}"
    else
      # Cannot tell which version would load: never claim a run is up to date.
      echo "${url} -> unresolved-$(date +%s)"
    fi
    # Only import specifiers, and read from the sources rather than the build:
    # bundled dependencies carry documentation URLs in their warnings, and
    # resolving those would tie this to a documentation site. Lit is bundled, so
    # this finds nothing today — it is here to notice a CDN import coming back.
  done < <(grep -rhoE '(from|import)[[:space:]]*\(?["'"'"']https://[^"'"'"']+' \
    "$ROOT/src" |
    grep -oE 'https://[^"'"'"']+' | sort -u)
}

# Everything that can change what the screenshots look like. The image is
# identified by its remote digest, so a new :stable release invalidates this
# without anything being pulled.
fingerprint() {
  local digest
  digest="$(docker manifest inspect "$HA_IMAGE" 2>/dev/null | shasum -a 256 | cut -d" " -f1)"
  if [[ -z "$digest" ]]; then
    # Unknown image identity: never claim a run is up to date.
    echo "unknown-$(date +%s)"
    return
  fi
  {
    echo "$digest"
    cdn_imports
    echo "sweep=${SWEEP_THEMES:-0} all=${ALL_THEMES:-0} filter=${THEME_FILTER:-}"
    # A theme release changes what the sweep captures, so it has to invalidate
    # the render as surely as a change to the card does.
    if [[ -n "$theme_pins" && -f "$theme_pins" ]]; then
      cat "$theme_pins"
    fi
    echo "strict=${STRICT_THUMBS:-1}/${STRICT_THEMES:-1}"
    # The sources the card is built from, not the build: the artifact is derived
    # from these, and hashing it would mean building before a fingerprint can be
    # taken — which the caller may only want in order to decide whether to.
    find "$ROOT/src" "$ROOT/tools" "$ROOT/tests" \
      "$ROOT/package.json" "$ROOT/package-lock.json" -type f \
      -not -path "*/screenshots/*" -not -path "*/.theme-cache/*" \
      -not -path "*/.render-cache/*" -print0 |
      sort -z | xargs -0 shasum -a 256
  } | shasum -a 256 | cut -d" " -f1
}

print=$(fingerprint)
if [[ "$fingerprint_only" == "1" ]]; then
  echo "$print"
  [[ "${own_pins:-0}" == "1" ]] && rm -f "$theme_pins"
  exit 0
fi

stamp="${stamp_dir}/${print}"
if [[ "${FORCE_RENDER:-0}" != "1" && -f "$stamp" ]] &&
  compgen -G "$OUT_DIR/*.png" >/dev/null; then
  echo "==> nothing changed since the last run; skipping"
  cat "$stamp"
  echo "    (FORCE_RENDER=1 to render anyway)"
  exit 0
fi

workdir="$(mktemp -d)"

# Home Assistant writes its .storage as root inside the container. Docker
# Desktop remaps that to the calling user, but on Linux it stays root-owned and
# the host cannot delete it, so the removal is done from a container that can.
remove_workdir() {
  rm -rf "$workdir" 2>/dev/null && return 0
  docker run --rm -v "$workdir:/workdir" "$HA_IMAGE" \
    find /workdir -mindepth 1 -delete >/dev/null 2>&1 || true
  rm -rf "$workdir" 2>/dev/null || true
}

cleanup() {
  [[ "${own_pins:-0}" == "1" ]] && rm -f "$theme_pins"
  if [[ "${KEEP_HA:-0}" == "1" ]]; then
    echo "==> leaving ${CONTAINER} running on http://localhost:${PORT} (user: render / render-password)"
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    remove_workdir
  fi
  # Never let tidying up decide the result of the run.
  return 0
}
trap cleanup EXIT

# The seed config is copied out of the repo so Home Assistant's generated
# .storage, logs, and database never touch the working tree.
build_card

echo "==> preparing config (${workdir})"
cp -R "$ROOT/tests/ha-config/." "$workdir/"
mkdir -p "$workdir/www" "$workdir/themes" "$OUT_DIR"
cp "$ROOT/ha-range-entities-slider.js" "$workdir/www/"

: >"$workdir/resources.yaml"

if [[ "${SWEEP_THEMES:-0}" == "1" ]]; then
  "$ROOT/tests/install-themes.sh" "$workdir"
  # Keep the resolved theme commits beside the screenshots they produced.
  mkdir -p "$OUT_DIR"
  cp "$workdir/theme-versions.txt" "$OUT_DIR/theme-versions.txt"
  # Whatever the packs asked for, in the order they declared it: card-mod first,
  # since themes that use card-mod-theme keys need it loaded before their styles
  # can apply.
  while read -r url type; do
    [[ -n "$url" ]] || continue
    printf -- '- url: %s\n  type: %s\n' "$url" "$type" >>"$workdir/resources.yaml"
  done <"$workdir/theme-resources.txt"
fi

printf -- '- url: /local/ha-range-entities-slider.js\n  type: module\n' >>"$workdir/resources.yaml"

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
  -e DIAGNOSE_ZOOM="${DIAGNOSE_ZOOM:-0}" \
  -e DIAGNOSE_GAP="${DIAGNOSE_GAP:-0}" \
  -e DIAGNOSE_PATCH="${DIAGNOSE_PATCH:-0}" \
  "$RENDER_IMAGE" node /tests/render.mjs || status=$?

if [[ "$status" != "0" ]]; then
  echo "==> render failed; last Home Assistant log lines:" >&2
  docker logs --tail 40 "$CONTAINER" >&2 || true
  exit "$status"
fi

# The README embeds captures straight from the latest release, so a rename here
# would blank it silently. Check the names it expects were actually produced.
missing=0
while read -r asset; do
  [[ -n "$asset" ]] || continue
  if [[ ! -f "$OUT_DIR/$asset" ]]; then
    echo "error: README embeds ${asset}, which this run did not produce" >&2
    missing=$((missing + 1))
  fi
done < <(grep -oE 'releases/latest/download/[^"]+\.png' "$ROOT/README.md" 2>/dev/null | sed 's|.*/||' | sort -u)
if [[ "$missing" -gt 0 ]]; then
  exit 1
fi

# Record what this fingerprint was rendered against, including the version the
# instance actually reported rather than just the tag that was asked for.
mkdir -p "$stamp_dir"
version="$(node -e 'try{process.stdout.write(require(process.argv[1]).haVersion)}catch{process.stdout.write("unknown")}' "$OUT_DIR/render-info.json" 2>/dev/null || echo unknown)"
{
  printf -- '    rendered against Home Assistant %s (tag: %s)\n' "$version" "$HA_VERSION"
  cdn_imports | sed 's/^/    /'
} >"$stamp"

exit "$status"
