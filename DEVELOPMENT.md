# Development

The card is TypeScript under `src/`, bundled with [esbuild](https://esbuild.github.io/) into the
single `ha-range-entities-slider.js` Home Assistant loads, with Lit compiled in rather than fetched
from a CDN at runtime. Home Assistant's own types come from
[custom-card-helpers](https://github.com/custom-cards/custom-card-helpers), as in the community
[boilerplate-card](https://github.com/custom-cards/boilerplate-card).

That built file is **not committed** — it is gitignored, built on demand, and attached to each
release, which is where HACS resolves a plugin's `filename` from. `just build` produces it, and
anything that needs it (`just check`, `just render`) builds it first.

The build runs in a `node:24-alpine` container, so Docker remains the only thing this repository
needs installed, the same as the render test. `LOCAL_NODE=1 just build` uses the host's node instead.

Task running uses [just](https://github.com/casey/just); `just` on its own lists the recipes.

| Recipe                 | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `just build`           | Typechecks and bundles `src/` into the card                                      |
| `just check`           | Builds, parses the card as an ES module, validates `hacs.json`, flags version drift |
| `just render [ver]`    | Renders the card in a real Home Assistant and checks it (`stable` by default)    |
| `just render-all`      | Renders against both Home Assistant `stable` and `beta`                          |
| `just render-themes`   | Renders the row under the custom theme packs                                     |
| `just fmt`             | Formats with prettier (`fmt-check` to verify only)                               |
| `just changelog`       | Shows the pending `[Unreleased]` entries                                          |
| `just bump <level>`    | Promotes `[Unreleased]`, rewrites `VERSION`, commits, and tags                   |
| `just release`         | Pushes the commit and tag, then creates the GitHub release                       |
| `just publish <level>` | `bump` followed by `release`                                                     |
| `just notes [version]` | Prints the notes recorded for a version                                          |
| `just gallery [tag]`   | Previews the screenshot gallery CI appends to the release notes                  |

## Render test

`just render` boots Home Assistant in Docker against a seeded config, completes onboarding through
the API, and drives Playwright to load the dashboard and check the row. Docker is the only host
requirement — the browser and Playwright itself live in the image built from
[tests/Dockerfile](tests/Dockerfile).

It checks that the row mounts, the slider is in range mode, `min`/`max`/`step` and both handles
follow the entities, that the readout formats exactly as the stock rows do, that the handles cannot
be dragged past each other, and that the Material You patch lands inside `ha-slider`'s shadow root.
That last one matters most: the patch targets private ids (`#thumb-min`, `#thumb-max`, `#indicator`)
that upstream can rename at any time.

```bash
just render              # Home Assistant stable
just render beta
KEEP_HA=1 just render    # leave HA up on http://localhost:8124 (render / render-password)
```

Screenshots land in `tests/screenshots/` (gitignored, uploaded as CI artifacts) — one capture per
colour scheme, of a single list holding the custom row, the stock `input_number` slider rows for the
same entities, and the edge cases. The top row is held mid-drag while each capture is taken, so the
value popup and whatever the theme does to a handle being moved are both visible; the pointer
returns to where it started before releasing, leaving the entities as they were. So each capture doubles as a side-by-side comparison, and the
theme sweep frames its captures identically.

A run is skipped when nothing that affects it has changed: the card, the tests, the settings, the
remote digest of the Home Assistant image, whatever the card's runtime imports currently resolve to
(`lit@2` follows the unpkg redirect to `lit@2.8.0`, so a Lit release counts as a change), and when
sweeping, the commits the theme packs point at. `FORCE_RENDER=1` renders regardless. The version the
instance actually reported is recorded in `render-info.json` beside the screenshots, and the resolved
theme commits in `theme-versions.txt`.

## Custom themes

`just render-themes` additionally downloads these theme packs into the test config and screenshots
the row under a curated selection of them:

| Pack                                                                                                                                          | Themes swept                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [card-mod](https://github.com/thomasloven/lovelace-card-mod)                                                                                  | none — a resource the packs below depend on        |
| [material-you-theme](https://github.com/Nerwyn/material-you-theme) + [material-you-utilities](https://github.com/Nerwyn/material-you-utilities) | Material You                                       |
| [catppuccin/home-assistant](https://github.com/catppuccin/home-assistant)                                                                     | Catppuccin Latte, Catppuccin Mocha                 |
| [homeassistant-visionos-theme](https://github.com/Nezz/homeassistant-visionos-theme)                                                          | visionos, Liquid Glass                             |
| [Metrology-for-Hass](https://github.com/Madelena/Metrology-for-Hass)                                                                          | Metro Blue, Fluent Slate                           |
| [graphite](https://github.com/TilmanGriesel/graphite)                                                                                         | Graphite, Graphite Light                           |
| [lovelace-ios-themes](https://github.com/basnijholt/lovelace-ios-themes)                                                                      | ios-light-mode-light-blue, ios-dark-mode-dark-blue |
| [macOS-Theme](https://github.com/JuanMTech/macOS-Theme)                                                                                       | macOS Theme                                        |
| [ha-lcars](https://github.com/th3jesta/ha-lcars)                                                                                              | LCARS Default                                      |
| [frosted-glass-themes](https://github.com/wessamlauf/homeassistant-frosted-glass-themes)                                                       | Frosted Glass, Frosted Glass Dark                  |
| [pipboy-theme](https://github.com/iosue-iulianus/homeassistant-pipboy-theme)                                                                  | Pip-Boy                                            |

```bash
just render-themes
ALL_THEMES=1 just render-themes                        # every installed theme
THEME_FILTER="Graphite,Catppuccin" just render-themes   # substring match
REFRESH_THEMES=1 just render-themes                     # ignore the download cache
```

Packs declare what they need beyond a theme file, and the installer sets it up: where their themes
live if not `themes/*.yaml` (ha-lcars builds a single flattened file), files to serve from `/local/`,
and stylesheet URLs. ha-lcars needs all three — its flattened theme, its `lcars.js`, and the Antonio
font from Google Fonts — plus the `input_boolean`/`input_number`/template helpers its README lists,
which the test config declares at the theme's own defaults.

card-mod is installed as a dashboard resource, loaded before the theme modules and the card itself:
16 of the 20 installed theme files put styling behind `card-mod-theme` keys — 33 references in
Metrology alone, plus visionOS, Liquid Glass, LCARS, Pip-Boy, Frosted Glass and every Graphite
variant — and those styles silently do nothing without it. The sweep asserts it registered.

The packs expand to 91 themes, so the sweep renders a representative pair per pack rather than every
accent colour, and skips the "Do Not Use" base themes the packs ship for inheritance. Each theme is
captured in light and dark only when that makes a difference: a theme that declares its colours
outright, or declares light and dark modes with identical values, is captured once and its screenshot
carries no mode suffix. That is decided by comparing how the theme actually resolves, not just what it
declares, and the run reports which themes were captured once.

Some packs ship a theme's two modes as two themes rather than declaring `modes:` for Home Assistant
to choose between — "Frosted Glass" and "Frosted Glass Dark", "Graphite" and "Graphite Light",
`ios-light-mode-light-blue` and `ios-dark-mode-dark-blue`. Those are paired on the name with every
light and dark word dropped: what is left has to match and the two have to disagree about which they
are, with an unstated name taking its sibling's opposite, so Frosted Glass is the light one and
Graphite the dark one. Each half is captured only in the scheme it is the theme for and the pair is
reported and published as one theme, which is what turned 16 gallery entries and 25 captures into 13
and 24 — the four it dropped were a light theme forced dark and a dark theme forced light, states
nobody using the theme sees. A `THEME_FILTER` naming only one half leaves it unpaired and captured in
both.

Theme tarballs are cached in `tests/.theme-cache` (gitignored) under the commit each pack currently
points at, resolved with `git ls-remote`, so an upstream release fetches a new file and an unchanged
pack is never downloaded twice. `GITHUB_TOKEN` raises the API rate limit, and CI passes one
automatically.

The sweep checks that the range handle gets a painted body under every theme, and fails if one does
not (`STRICT_THEMES=0` downgrades that to a warning). This is what caught the handles rendering as a
bare gap in the track under every non-Material-You pack: the styling was material-you's own, applied
unconditionally, and now branches on whether that theme is active.

`DIAGNOSE_ZOOM=1` adds magnified crops of our handle and the stock one, which is how the handle
sizing and corner bugs were found; `DIAGNOSE_PATCH=1` adds a capture with the card's shadow-DOM patch
detached, for attributing a rendering problem to the card or to Home Assistant;
`DIAGNOSE_STOCK_DRAG=1` repeats every capture with a stock row held mid-drag instead of ours, for
comparing the two in a state that only exists during a gesture. All three are off by default — they
double or better the captures a sweep takes and nothing publishes them.

`BROWSER=firefox` or `BROWSER=webkit` drives that engine instead of Chromium, and the
[Browsers](.github/workflows/browsers.yml) workflow runs both weekly against Material You — the theme
that styles a drag. The published screenshots stay Chromium's; the point of the others is that the row
reaches into `ha-slider`'s shadow DOM, where engines differ. The handle's held styling was keyed on
`#slider:has(~ #tooltip-thumb-max[open])`, which Firefox matches and gives the right precedence but
never restyles the thumb for, so the handle stayed full width there while every Chromium run passed.
It is now keyed on a `held` attribute the card mirrors from the tooltips, and the held-handle check
compares against the stock row in the same engine rather than against remembered Chromium numbers.

Page errors are reported with the step that was running when they were thrown, which is what
attributes one to the card rather than to Home Assistant's own boot, and `DIAGNOSE_ERRORS=1` adds
deeper stack frames and matches failed websocket commands back to what was sent. Two Home Assistant
errors are known and counted rather than listed: `ha-entity-picker` reads `this._i18n.localize`
unguarded in `render()`, and `_i18n` is a Lit context it consumes rather than a property it is
passed, so its first render can beat the provider on `<home-assistant>`; and a websocket command the
frontend sends that this build's backend does not implement rejects with a bare object. Neither
involves this card — see `KNOWN_NOISE` in [render.mjs](tests/render.mjs).

## Continuous integration

[render.yml](.github/workflows/render.yml) holds the render and is called by the workflows behind the
README's badges — [stable](.github/workflows/stable.yml) and [beta](.github/workflows/beta.yml)
daily, [themes](.github/workflows/themes.yml) weekly — so each reports its own status while the
render itself is defined once. A scheduled run whose fingerprint has not moved restores its
screenshots in seconds, so the daily cadence costs little; a failure means Home Assistant, a theme
pack, or the Lit build actually changed.

Note that GitHub disables scheduled workflows in public repositories after 60 days without repository
activity, and sends failure notifications to whoever last edited the cron line.

## Releasing

**Every change documents itself.** Add entries under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md)
as part of the change, in the same commit. `just bump` promotes that section to the new version with
today's date and **refuses to run when it is empty**, and `just release` uses that section as the
GitHub release notes — so notes never come from raw commit subjects.

The version lives in one place: the `VERSION` const in `src/range-entity-row.ts`, which is also
printed to the browser console when the card loads. `just bump` rewrites it, rebuilds, and tags
`vX.Y.Z`.

```bash
# after editing the card and adding a CHANGELOG entry
just check
just bump minor    # patch | minor | major
just release
```

Pushing a `v*` tag also runs [the release workflow](.github/workflows/release.yml), which renders the
card and the theme sweep against a real Home Assistant, attaches the screenshots to the release, and
rewrites its notes as the changelog entry for that version followed by a gallery of those captures
(`just gallery` previews it). They go on as **release assets** rather than workflow artifacts
deliberately: artifacts expire — 90 days by default — whereas release assets last as long as the
release and have deterministic URLs, so the notes can embed them. About 4 MB per release for the 27
captures.

`just release` and the workflow both tolerate the other having gone first, so it does not matter
which creates the release.

The README embeds `overview-stable-light.png` and `overview-stable-dark.png` through
`releases/latest/download/`, which always resolves to the newest release. The capture names are
fixed, so the README never needs updating and no images are committed — but it does mean renaming
those two captures breaks it, and that they are blank until the first release publishes them.
