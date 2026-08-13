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
- ha-lcars in the theme sweep. It needs more than a theme file, so packs now
  declare where their themes live, which files to serve from `/local/`, and which
  stylesheet URLs to add: LCARS ships its themes flattened outside `themes/`, and
  needs `lcars.js` and the Antonio font, plus the helper entities its README
  lists, which the test config declares at the theme's own default values.
- Frosted Glass and Pip-Boy in the theme sweep. Both need only card-mod, which
  the sweep already installs; Pip-Boy pulls its Share Tech Mono font in with an
  `@import` inside the theme.
- Theme sweep (`just render-themes`): installs the Material You, Catppuccin,
  visionOS, Metrology, Graphite, iOS, macOS, LCARS, Frosted Glass and Pip-Boy
  theme packs and screenshots the
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
  render, and the release notes list what the captures were taken against. Those
  commits are resolved once per run and passed to the fingerprint, the download
  and the recorded versions through `THEME_PINS`, so a pack that moves mid-run
  cannot leave the three disagreeing.
- One screenshot per colour scheme of a single list holding the custom row, the
  stock rows and the edge cases, replacing four separate element captures. The
  theme sweep frames its captures the same way, and the top row is held mid-drag
  so every capture shows the value popup and the theme's own drag treatment.
- Separate status badges for Home Assistant stable, beta and the theme sweep.
  A badge reports one workflow, so each is a thin caller of the shared render
  workflow rather than a copy of it. Stable and beta run daily now that an
  unchanged run is restored rather than re-rendered.
- Release workflow: pushing a `v*` tag renders the card and the theme sweep,
  attaches the screenshots to the release, and rewrites its notes as the
  changelog entry plus a gallery of those captures. They are release assets, not
  workflow artifacts, so they do not expire and the notes can link them.
- The theme sweep writes `manifest.json` alongside its captures, recording which
  theme and mode each file holds — the filenames alone are ambiguous, since
  `graphite-light.png` is the Graphite Light theme rather than Graphite in light
  mode.

- The README shows the card rendered against a real Home Assistant, in light or
  dark to match the reader, embedded from the latest release's assets rather than
  from images committed here. The URLs need no updating as releases come and go,
  and a render fails if a capture the README embeds is no longer produced.
- Development, testing and release documentation moved out of the README into
  DEVELOPMENT.md, leaving the README to installation, usage and configuration.

- `number` entities are supported alongside `input_number`, writing with that
  entity's own `set_value` service. Any other domain is refused at config time
  rather than rendering a row that can never write.
- `hacs.json` declares Home Assistant 2026.8.0 as the minimum. Older versions
  mostly work — every functional check passes on 2026.6 — but Home Assistant gave
  its slider rows horizontal gutters after that, so the row sits about 8px out of
  alignment with its neighbours on anything earlier.

- A visual editor, so the row can be configured from the entities card's UI
  rather than only in YAML. Rows get editors the same way cards do —
  `hui-row-element-editor` resolves the row's class and calls its static
  `getConfigElement()` — and it is built on `ha-form` with a selector schema, so
  the entity pickers, icon picker and layout are Home Assistant's own.

### Changed

- The card is now TypeScript under `src/`, bundled with esbuild, with Lit
  compiled in rather than fetched from unpkg at runtime — so it no longer
  depends on a CDN being reachable, or on whatever `lit@2` happens to resolve to.
  Home Assistant's types come from custom-card-helpers.
- The built file is no longer committed. It is produced by `just build` and
  attached to each release, which is where HACS resolves a plugin's filename
  from; install manually by downloading it from the latest release.

- The handles no longer push each other: dragging one up to the other stops it
  there, instead of shoving the other along to the end of the track.
- An inverted pair (`range_entity` below `entity`) is now flagged rather than
  quietly presented in order. The readout shows the values as the entities hold
  them, with an exclamation icon in the error colour explaining it on hover, and
  the new `warn_inverted: false` option opts out.

- Under material-you the handle now narrows and the gap tightens while it is
  being dragged, as the stock row's does. The theme keys that off `#tooltip`,
  which a range slider does not have — its popups are per handle — so those
  rules never matched and the handle sat still.

### Fixed

- A row whose entity Home Assistant does not have rendered nothing at all, which
  is indistinguishable from the row being absent. It now shows a warning naming
  the entity, as the stock rows do.
- An unavailable entity produced `NaN` for itself and for its partner, since the
  values are sorted together. The row now keeps its place with the slider
  disabled, spells out the unavailable state, and leaves the partner's own value
  intact.
- Values are clamped to each entity's own `min`/`max` before being written. The
  slider spans the widest range across the pair, so a handle could reach a value
  its own entity would reject.
- With both handles on the same value, material-you painted stray slivers beside
  them: the active track has no width there, so the gap and its corner shapes had
  nothing to sit against. The slider is now marked collapsed in that case, which
  also covers a row whose partner is unavailable.
- An unavailable entity read as "Unavailable", which is both unlike the stock
  row — it shows an em dash — and too long for the column, wrapping mid-word.
- The unit could disappear from the readout under a theme with a wide font — the
  two-line readout wrapped it onto a third line the row height clipped. Each
  value now stays on one line.

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
