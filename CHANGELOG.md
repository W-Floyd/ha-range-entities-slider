# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add entries under `## [Unreleased]` as part of the change itself — `just bump`
promotes that section to the new version and refuses to run if it is empty.

## [Unreleased]

### Added

- Automated render test (`just render`): boots Home Assistant in Docker, onboards
  through the API, and drives Playwright to check that the row mounts, the slider
  tracks both entities, and the Material You patch still applies inside
  `ha-slider`'s shadow root. Captures light and dark screenshots alongside stock
  `input_number` slider rows for comparison.
- `Render` workflow running that test against Home Assistant `stable` and `beta`
  on push and weekly, so upstream frontend changes that break the shadow-DOM
  patch surface before users hit them.
- The theme sweep captures a theme in both light and dark only when the two
  actually differ, comparing how the theme resolves rather than what it declares:
  6 of the 12 curated themes render identically either way, so 24 combinations
  become 18 and their screenshots lose the misleading mode suffix.
- The theme sweep installs card-mod as a dashboard resource, loaded ahead of the
  theme modules. 8 of the 12 installed theme files put styling behind
  `card-mod-theme` keys, which silently did nothing without it — visionOS renders
  its translucent card only once card-mod is present.
- Theme sweep (`just render-themes`): installs the Material You, Catppuccin,
  visionOS, Metrology, Graphite, iOS, and macOS theme packs and screenshots the
  row under a curated selection, failing if the range handle is left unpainted
  under any of them. Runs weekly in CI.

- A render is skipped when nothing that affects it has changed — the card, the
  tests, the settings, the remote digest of the Home Assistant image, what the
  card's floating CDN imports resolve to, and the commits the theme packs point
  at — restoring the previous screenshots instead. CI keys its caches on the same
  fingerprint, and what the run was rendered against, down to the Home Assistant
  version the instance reported and the exact Lit build, is recorded beside the
  screenshots.
- Theme packs are pinned to the commit their default branch points at and cached
  under it, so an upstream theme release invalidates both the download and the
  render, and the release notes list what the captures were taken against.
- One screenshot per colour scheme of a single list holding the custom row, the
  stock rows and the edge cases, replacing four separate element captures. The
  theme sweep frames its captures the same way.
- Release workflow: pushing a `v*` tag renders the card and the theme sweep,
  attaches the screenshots to the release, and rewrites its notes as the
  changelog entry plus a gallery of those captures. They are release assets, not
  workflow artifacts, so they do not expire and the notes can link them.
- The theme sweep writes `manifest.json` alongside its captures, recording which
  theme and mode each file holds — the filenames alone are ambiguous, since
  `graphite-light.png` is the Graphite Light theme rather than Graphite in light
  mode.

### Changed

- The handles no longer push each other: dragging one up to the other stops it
  there, instead of shoving the other along to the end of the track.
- An inverted pair (`range_entity` below `entity`) is now flagged rather than
  quietly presented in order. The readout shows the values as the entities hold
  them, with an exclamation icon in the error colour explaining it on hover, and
  the new `warn_inverted: false` option opts out.

### Fixed

- Values are formatted like the stock `input_number` row: decimal places from
  each entity's own `step`, the user's number format setting, and each entity's
  own unit. Previously a `step: 0.5` entity read `18 °C` where the stock row
  read `18.0 °C`.
- The slider was missing the `1px var(--ha-space-2)` gutters the stock row gives
  its own, so the track ran into the value readout and sat out of line with the
  rows around it. Home Assistant uses that margin to keep the thumb at min and
  max from being clipped by the card's `overflow-x`.
- Under material-you both sides of each handle ended square against it.
  material-you-utilities styles only the single `#thumb`, never the range pair,
  so its treatment of that junction is now mirrored for both ends of the range
  indicator: the 2px active-track corner, the 6px gap, and the
  "inactive track inner corner shape" (`#indicator::after`) that rounds the
  inactive side. The card had been hiding that shape outright, which is why one
  side stayed square.

- Range handles were invisible under every theme except material-you, showing
  only as a gap in the track. The handle styling was material-you's — bars drawn
  from `--md-sys-*` variables no other theme defines — and was applied
  unconditionally. The styling now branches on whether material-you is active:
  under it the bars are unchanged, and elsewhere the handles match the knob on a
  stock `input_number` slider row, matching its size, shape, colour and lack of
  border. material-you renders pixel-identically to before.

## [0.1.0] - 2026-08-13

### Added

- `custom:range-entity-row`: an entity row that renders two `input_number`
  entities as a single dual-handle range slider, with `min`/`max`/`step` and the
  unit derived from the two entities' attributes.
- Optional `name` and `icon` overrides, plus `tap_action`, `hold_action`, and
  `double_tap_action` passthrough to `hui-generic-entity-row`.
- Styling fix for the Material You theme, which does not style range-slider
  thumbs correctly out of the box.
- README covering installation, usage, and the configuration options.
- MIT license.
- `justfile` with recipes for checks, version bumping, and releases, and a
  `VERSION` const in the card as the single source of truth.
- This changelog, in Keep a Changelog format. `just bump` promotes the
  `[Unreleased]` section to the new version and `just release` publishes it as
  the GitHub release notes.

[unreleased]: https://github.com/W-Floyd/ha-range-entities-slider/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/W-Floyd/ha-range-entities-slider/releases/tag/v0.1.0
