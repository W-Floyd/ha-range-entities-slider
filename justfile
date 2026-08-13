set shell := ["bash", "-uc"]

js := "ha-range-entities-slider.js"

# List available recipes
default:
    @just --list

# Print the current version (from the VERSION const in the card)
version:
    @grep -oE 'const VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' {{ js }} | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'

# Syntax-check the card, validate hacs.json, and check version/tag consistency
check:
    #!/usr/bin/env bash
    set -euo pipefail

    # The card is an ES module, so check it as .mjs — plain `node --check` on a
    # .js file parses as CommonJS and chokes on the import statement.
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    cp {{ js }} "$tmp/card.mjs"
    node --check "$tmp/card.mjs"
    echo "ok: {{ js }} parses as an ES module"

    node -e 'const c = require("./hacs.json"); for (const k of ["name", "filename"]) if (!c[k]) throw new Error("hacs.json missing " + k);'
    echo "ok: hacs.json is valid JSON with the required keys"

    filename="$(node -e 'process.stdout.write(require("./hacs.json").filename)')"
    if [[ "$filename" != "{{ js }}" ]]; then
      echo "error: hacs.json filename ($filename) does not match {{ js }}" >&2
      exit 1
    fi
    echo "ok: hacs.json filename matches the card"

    version="$(just version)"
    if git rev-parse -q --verify "refs/tags/v${version}" >/dev/null; then
      if ! git diff --quiet "v${version}" -- {{ js }}; then
        echo "warning: v${version} is already tagged but {{ js }} has changed since — run 'just bump' before releasing" >&2
      else
        echo "ok: v${version} is tagged and unchanged"
      fi
    else
      echo "ok: version ${version} is not yet tagged"
    fi

# Format with prettier (downloads it on demand via npx)
fmt:
    npx --yes prettier --write {{ js }} hacs.json README.md

# Check formatting without writing
fmt-check:
    npx --yes prettier --check {{ js }} hacs.json README.md

# Bump the version (level: patch | minor | major), then commit and tag
bump level="patch":
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
      echo "error: working tree is dirty — commit or stash first" >&2
      exit 1
    fi

    current="$(just version)"
    IFS=. read -r major minor patch <<<"$current"
    case "{{ level }}" in
      major) major=$((major + 1)); minor=0; patch=0 ;;
      minor) minor=$((minor + 1)); patch=0 ;;
      patch) patch=$((patch + 1)) ;;
      *) echo "error: level must be one of: major, minor, patch" >&2; exit 1 ;;
    esac
    next="${major}.${minor}.${patch}"

    if git rev-parse -q --verify "refs/tags/v${next}" >/dev/null; then
      echo "error: tag v${next} already exists" >&2
      exit 1
    fi

    # BSD sed (macOS) requires an argument to -i.
    sed -i.bak -E "s/const VERSION = \"[0-9]+\.[0-9]+\.[0-9]+\"/const VERSION = \"${next}\"/" {{ js }}
    rm -f {{ js }}.bak

    just check

    git add {{ js }}
    git commit -m "Release v${next}"
    git tag -a "v${next}" -m "v${next}"
    echo "bumped ${current} -> ${next} and tagged v${next}; run 'just release' to publish"

# Push the release commit and tag, then create the GitHub release
release:
    #!/usr/bin/env bash
    set -euo pipefail

    version="$(just version)"
    tag="v${version}"

    if ! git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
      echo "error: tag ${tag} does not exist — run 'just bump' first" >&2
      exit 1
    fi
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
      echo "error: working tree is dirty — commit or stash first" >&2
      exit 1
    fi

    just check

    git push origin HEAD
    git push origin "${tag}"
    # The card is attached as a release asset: HACS prefers a matching asset
    # over the repo root when one is present.
    gh release create "${tag}" --title "${tag}" --generate-notes {{ js }}
    echo "released ${tag}"

# Bump and release in one step (level: patch | minor | major)
publish level="patch": (bump level) release

# Show what a release would include since the previous tag
changelog:
    #!/usr/bin/env bash
    set -euo pipefail
    previous="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)"
    if [[ -z "$previous" ]]; then
      echo "No previous tag; all commits:"
      git log --oneline
    else
      echo "Changes since ${previous}:"
      git log --oneline "${previous}..HEAD"
    fi

# Symlink the card into a local HA config's www/ for development
link config_dir:
    #!/usr/bin/env bash
    set -euo pipefail
    target="{{ config_dir }}/www/{{ js }}"
    mkdir -p "{{ config_dir }}/www"
    ln -sf "$(pwd)/{{ js }}" "$target"
    echo "linked -> $target"
    echo "add /local/{{ js }} as a JavaScript module resource in HA"
