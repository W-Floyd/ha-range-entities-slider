#!/usr/bin/env bash
#
# Downloads the custom themes the render sweep checks against into a Home
# Assistant config dir: themes/*.yaml, plus material-you-utilities' frontend
# module, which the Material You theme needs for its dynamic colours.
#
# Usage: tests/install-themes.sh <config_dir>
#
# Tarballs come from the GitHub API so no branch names are hardcoded — each repo
# resolves to its own default branch — and are cached, since the sweep is run
# repeatedly and unauthenticated GitHub allows only 60 requests an hour.
#
# Env:
#   THEME_CACHE=<dir>   where tarballs are kept (default tests/.theme-cache)
#   THEME_CACHE_TTL=<s> re-download anything older than this (default 604800, a week)
#   REFRESH_THEMES=1    ignore the cache and re-download everything
#   GITHUB_TOKEN=<tok>  raises the API rate limit; CI sets this automatically
#
set -euo pipefail

target="${1:?usage: install-themes.sh <config_dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="${THEME_CACHE:-$ROOT/tests/.theme-cache}"
ttl="${THEME_CACHE_TTL:-604800}"

# repo | extra file to drop into www/ (optional)
#
# card-mod carries no themes of its own: several of the packs below use
# card-mod-theme keys and silently lose those styles without it.
THEMES=(
  "thomasloven/lovelace-card-mod|card-mod.js"
  "Nerwyn/material-you-theme|"
  "Nerwyn/material-you-utilities|dist/material-you-utilities.min.js"
  "catppuccin/home-assistant|"
  "Nezz/homeassistant-visionos-theme|"
  "Madelena/Metrology-for-Hass|"
  "TilmanGriesel/graphite|"
  "basnijholt/lovelace-ios-themes|"
  "JuanMTech/macOS-Theme|"
)

mkdir -p "$target/themes" "$target/www" "$cache"

auth=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

failed=0

for entry in "${THEMES[@]}"; do
  repo="${entry%%|*}"
  extra="${entry##*|}"
  tarball="${cache}/${repo//\//-}.tar.gz"

  fresh=0
  if [[ "${REFRESH_THEMES:-0}" != "1" && -s "$tarball" ]]; then
    age=$(( $(date +%s) - $(stat -f %m "$tarball" 2>/dev/null || stat -c %Y "$tarball") ))
    [[ "$age" -lt "$ttl" ]] && fresh=1
  fi

  if [[ "$fresh" == "1" ]]; then
    echo "==> ${repo} (cached)"
  else
    echo "==> ${repo} (downloading)"
    # Download to a temp file first so an interrupted fetch cannot poison the
    # cache with a truncated tarball.
    # ${auth[@]+...} keeps `set -u` happy when no token is set: bash 3.2 treats
    # an empty array expansion as unbound.
    if ! curl -fsSL ${auth[@]+"${auth[@]}"} \
      "https://api.github.com/repos/${repo}/tarball" -o "${tarball}.part"; then
      rm -f "${tarball}.part"
      if [[ -s "$tarball" ]]; then
        echo "    download failed; using the stale cached copy" >&2
      else
        echo "    download failed and nothing cached" >&2
        failed=$((failed + 1))
        continue
      fi
    else
      mv "${tarball}.part" "$tarball"
    fi
  fi

  tmp="$(mktemp -d)"
  if ! tar -xzf "$tarball" --strip-components=1 -C "$tmp" 2>/dev/null; then
    echo "    cached tarball is unreadable; removing it, re-run to fetch again" >&2
    rm -f "$tarball"
    rm -rf "$tmp"
    failed=$((failed + 1))
    continue
  fi

  if [[ -d "$tmp/themes" ]]; then
    # Theme filenames can contain spaces (e.g. "Liquid Glass.yaml").
    found=0
    while IFS= read -r -d '' file; do
      cp "$file" "$target/themes/"
      found=$((found + 1))
    done < <(find "$tmp/themes" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) -print0)
    echo "    ${found} theme file(s)"
  fi

  if [[ -n "$extra" ]]; then
    if [[ -f "$tmp/$extra" ]]; then
      cp "$tmp/$extra" "$target/www/"
      echo "    resource $(basename "$extra")"
    else
      echo "    warning: no ${extra} in ${repo}" >&2
    fi
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
