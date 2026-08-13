#!/usr/bin/env bash
#
# Downloads the custom themes the render sweep checks against into a Home
# Assistant config dir: themes/*.yaml, plus the frontend modules some of them
# need — card-mod, which several packs put their styling behind, and
# material-you-utilities, which the Material You theme uses for its colours.
#
# Usage: tests/install-themes.sh <config_dir>
#        tests/install-themes.sh --versions
#
# Each pack is pinned to whatever its default branch currently points at,
# resolved with `git ls-remote`, which has no API rate limit. Tarballs are cached
# under that commit, so an upstream change fetches a new file instead of ageing
# one out, and an unchanged pack is never downloaded twice. `--versions` prints
# those commits: the render fingerprint and the CI cache key are built from them,
# so a theme release invalidates both.
#
# Env:
#   THEME_PINS=<file>   use the commits in this file (the output of --versions)
#                       instead of resolving again, so a pack that moves midway
#                       through a run cannot leave the fingerprint, the download
#                       and the recorded versions disagreeing
#   THEME_CACHE=<dir>   where tarballs are kept (default tests/.theme-cache)
#   REFRESH_THEMES=1    ignore the cache and re-download everything
#   GITHUB_TOKEN=<tok>  raises the API rate limit; CI sets this automatically
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="${THEME_CACHE:-$ROOT/tests/.theme-cache}"

# repo | where its theme files live | dashboard resources it needs
#
# Theme paths default to themes/*.yaml; packs that build elsewhere say so.
# Resources are comma separated `path>type`, where a path may be a file inside
# the repo (copied to www/ and served from /local/) or a URL. Order matters and
# is preserved: card-mod is first because several packs put their styling behind
# card-mod-theme keys and silently lose it when card-mod loads late or not
# at all.
THEMES=(
  "thomasloven/lovelace-card-mod||card-mod.js>module"
  "Nerwyn/material-you-theme||"
  "Nerwyn/material-you-utilities||dist/material-you-utilities.min.js>module"
  "catppuccin/home-assistant||"
  "Nezz/homeassistant-visionos-theme||"
  "Madelena/Metrology-for-Hass||"
  "TilmanGriesel/graphite||"
  "basnijholt/lovelace-ios-themes||"
  "JuanMTech/macOS-Theme||"
  # LCARS ships its themes flattened into one file outside themes/, and its
  # README requires both a script and a font stylesheet as resources. Antonio is
  # the Google Fonts option; the alternative, Tungsten, is not redistributable.
  "th3jesta/ha-lcars|theme_flat/lcars_flat.yaml|lcars.js>js,https://fonts.googleapis.com/css2?family=Antonio:wght@400;700&display=swap>css"
)

resolve() {
  git ls-remote "https://github.com/$1" HEAD 2>/dev/null | cut -f1 | head -1
}

# A pinned commit if the caller resolved one already, otherwise resolve it now.
lookup() {
  local repo="$1" pin
  if [[ -n "${THEME_PINS:-}" && -f "${THEME_PINS}" ]]; then
    pin="$(awk -v r="$repo" '$1 == r { print $2; exit }' "${THEME_PINS}")"
    if [[ -n "$pin" ]]; then
      echo "$pin"
      return 0
    fi
  fi
  resolve "$repo"
}

if [[ "${1:-}" == "--versions" ]]; then
  for entry in "${THEMES[@]}"; do
    repo="${entry%%|*}"
    echo "${repo} $(resolve "$repo")"
  done
  exit 0
fi

target="${1:?usage: install-themes.sh <config_dir> | --versions}"
mkdir -p "$target/themes" "$target/www" "$cache"

auth=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

failed=0
: >"$target/theme-versions.txt"
: >"$target/theme-resources.txt"

for entry in "${THEMES[@]}"; do
  IFS='|' read -r repo theme_paths resources <<<"$entry"
  [[ -n "$repo" && "$repo" != \#* ]] || continue
  slug="${repo//\//-}"

  commit="$(lookup "$repo")"
  if [[ -z "$commit" ]]; then
    # Cannot tell which version is current: fall back to whatever is cached
    # rather than failing the run, but say so.
    cached="$(ls -t "${cache}/${slug}-"*.tar.gz 2>/dev/null | head -1)"
    commit="$(basename "${cached:-}" .tar.gz)"
    commit="${commit#"${slug}-"}"
    if [[ -z "$commit" ]]; then
      echo "==> ${repo}: cannot resolve a version and nothing cached" >&2
      failed=$((failed + 1))
      continue
    fi
    echo "==> ${repo}: cannot resolve a version; using cached ${commit:0:7}" >&2
  fi

  echo "${repo} ${commit}" >>"$target/theme-versions.txt"
  tarball="${cache}/${slug}-${commit}.tar.gz"

  if [[ "${REFRESH_THEMES:-0}" != "1" && -s "$tarball" ]]; then
    echo "==> ${repo} ${commit:0:7} (cached)"
  else
    echo "==> ${repo} ${commit:0:7} (downloading)"
    # Download to a temp file first so an interrupted fetch cannot poison the
    # cache with a truncated tarball.
    # ${auth[@]+...} keeps `set -u` happy when no token is set: bash 3.2 treats
    # an empty array expansion as unbound.
    if ! curl -fsSL ${auth[@]+"${auth[@]}"} \
      "https://api.github.com/repos/${repo}/tarball/${commit}" -o "${tarball}.part"; then
      rm -f "${tarball}.part"
      echo "    download failed" >&2
      failed=$((failed + 1))
      continue
    fi
    mv "${tarball}.part" "$tarball"
    # Only the current commit is worth keeping.
    find "$cache" -maxdepth 1 -name "${slug}-*.tar.gz" \
      ! -name "$(basename "$tarball")" -delete
  fi

  tmp="$(mktemp -d)"
  if ! tar -xzf "$tarball" --strip-components=1 -C "$tmp" 2>/dev/null; then
    echo "    cached tarball is unreadable; removing it, re-run to fetch again" >&2
    rm -f "$tarball"
    rm -rf "$tmp"
    failed=$((failed + 1))
    continue
  fi

  found=0
  # Theme filenames can contain spaces (e.g. "Liquid Glass.yaml").
  for pattern in ${theme_paths:-themes/*.yaml themes/*.yml}; do
    while IFS= read -r -d '' file; do
      cp "$file" "$target/themes/"
      found=$((found + 1))
    done < <(find "$tmp" -type f -path "$tmp/$pattern" -print0 2>/dev/null)
  done
  [[ "$found" -gt 0 ]] && echo "    ${found} theme file(s)"

  if [[ -n "$resources" ]]; then
    IFS=',' read -ra wanted <<<"$resources"
    for item in "${wanted[@]}"; do
      path="${item%%>*}"
      type="${item##*>}"
      if [[ "$path" == http* ]]; then
        echo "${path} ${type}" >>"$target/theme-resources.txt"
        echo "    resource ${type}: ${path:0:48}…"
      elif [[ -f "$tmp/$path" ]]; then
        cp "$tmp/$path" "$target/www/"
        echo "/local/$(basename "$path") ${type}" >>"$target/theme-resources.txt"
        echo "    resource ${type}: $(basename "$path")"
      else
        echo "    warning: no ${path} in ${repo}" >&2
        failed=$((failed + 1))
      fi
    done
  fi

  rm -rf "$tmp"
done

installed="$(find "$target/themes" -type f | wc -l | tr -d ' ')"
echo "==> installed ${installed} theme file(s) (cache: ${cache})"

# Silently sweeping zero themes would look like a pass, so make it a failure.
if [[ "$installed" -lt 8 || "$failed" -gt 0 ]]; then
  echo "error: only ${installed} theme file(s) installed, ${failed} repo(s) failed" >&2
  exit 1
fi
