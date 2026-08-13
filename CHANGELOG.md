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
- Theme sweep (`just render-themes`): installs the Material You, Catppuccin,
  visionOS, Metrology, Graphite, iOS, and macOS theme packs and screenshots the
  row under a curated selection, failing if the range handle is left unpainted
  under any of them. Runs weekly in CI.

### Fixed

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
