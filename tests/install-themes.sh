#!/usr/bin/env bash
#
# Downloads the custom themes the render sweep checks against into a Home
# Assistant config dir: themes/*.yaml, plus material-you-utilities' frontend
# module, which the Material You theme needs for its dynamic colors.
#
# Usage: tests/install-themes.sh <config_dir>
#
# Tarballs come from the GitHub API so no branch names are hardcoded — each repo
# resolves to its own default branch.
#
set -euo pipefail

target="${1:?usage: install-themes.sh <config_dir>}"

# repo | extra file to drop into www/ (optional)
THEMES=(
  "Nerwyn/material-you-theme|"
  "Nerwyn/material-you-utilities|dist/material-you-utilities.min.js"
  "catppuccin/home-assistant|"
  "Nezz/homeassistant-visionos-theme|"
  "Madelena/Metrology-for-Hass|"
  "TilmanGriesel/graphite|"
  "basnijholt/lovelace-ios-themes|"
  "JuanMTech/macOS-Theme|"
)

mkdir -p "$target/themes" "$target/www"

for entry in "${THEMES[@]}"; do
  repo="${entry%%|*}"
  extra="${entry##*|}"
  echo "==> fetching ${repo}"

  tmp="$(mktemp -d)"
  if ! curl -fsSL "https://api.github.com/repos/${repo}/tarball" |
    tar -xz --strip-components=1 -C "$tmp"; then
    echo "warning: could not download ${repo}; skipping" >&2
    rm -rf "$tmp"
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
  else
    echo "    no themes/ directory"
  fi

  if [[ -n "$extra" ]]; then
    if [[ -f "$tmp/$extra" ]]; then
      cp "$tmp/$extra" "$target/www/"
      echo "    resource $(basename "$extra")"
    else
      echo "warning: ${repo} has no ${extra}" >&2
    fi
  fi

  rm -rf "$tmp"
done

echo "==> installed $(find "$target/themes" -type f | wc -l | tr -d ' ') theme file(s)"
