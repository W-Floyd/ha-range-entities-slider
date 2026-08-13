# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add entries under `## [Unreleased]` as part of the change itself — `just bump`
promotes that section to the new version and refuses to run if it is empty.

## [Unreleased]

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

[unreleased]: https://github.com/W-Floyd/ha-range-entities-slider/commits/main
