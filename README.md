# ha-range-entities-slider

A Home Assistant Lovelace **entity row** that renders two `input_number` entities as a single
dual-handle range slider.

Instead of stacking two separate number sliders in your dashboard, you get one row with a lower
handle and an upper handle — useful for temperature bands, humidity targets, brightness windows,
or any "from X to Y" setting stored as a pair of `input_number` helpers.

The row is built on Home Assistant's own `hui-generic-entity-row` and `ha-slider`, so it inherits
your theme, name/icon overrides, and tap actions.

## Features

- Single row, two handles, backed by two independent `input_number` entities
- `min`, `max`, and `step` are derived automatically from the two entities' attributes
  (widest `min`/`max`, smallest `step`)
- Unit of measurement picked up from either entity
- Live value readout while dragging; the service call fires only on release, formatted exactly as
  the stock `input_number` row would
- Handles stop at each other instead of pushing, and an inverted pair written from elsewhere is
  flagged rather than silently reordered
- Theme-aware handles: Home Assistant paints none on a range slider, so the row supplies them —
  bars under material-you, and the stock round knob everywhere else

## Installation

### HACS (recommended)

This repo is a HACS-compatible Lovelace plugin.

1. In HACS, open the three-dot menu → **Custom repositories**.
2. Add `https://github.com/W-Floyd/ha-range-entities-slider` with category **Dashboard**
   (formerly "Lovelace").
3. Install **Range Entity Row**, then reload your browser.

HACS registers the dashboard resource for you. If it doesn't, add it manually as below.

### Manual

1. Copy `ha-range-entities-slider.js` to `<config>/www/ha-range-entities-slider.js`.
2. Add the resource under **Settings → Dashboards → ⋮ → Resources**:

   - URL: `/local/ha-range-entities-slider.js`
   - Type: **JavaScript module**

3. Reload your browser.

## Usage

Create two `input_number` helpers, then use the row inside an **Entities** card:

```yaml
type: entities
entities:
  - type: custom:range-entity-row
    entity: input_number.lower_temp
    range_entity: input_number.upper_temp
    name: Temperature Range
    icon: mdi:thermometer
```

### Example helpers

```yaml
# configuration.yaml
input_number:
  lower_temp:
    name: Lower Temp
    min: 15
    max: 30
    step: 0.5
    unit_of_measurement: "°C"
  upper_temp:
    name: Upper Temp
    min: 15
    max: 30
    step: 0.5
    unit_of_measurement: "°C"
```

## Configuration options

| Option              | Type   | Required | Description                                                        |
| ------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `type`              | string | yes      | `custom:range-entity-row`                                          |
| `entity`            | string | yes      | `input_number` entity backing the **lower** handle                  |
| `range_entity`      | string | yes      | `input_number` entity backing the **upper** handle                  |
| `name`              | string | no       | Overrides the row label                                            |
| `warn_inverted`     | bool   | no       | Flag it when `range_entity` is below `entity` (default `true`)       |
| `icon`              | string | no       | Overrides the row icon                                             |
| `tap_action`        | object | no       | Standard Home Assistant action config, passed to the generic row    |
| `hold_action`       | object | no       | Standard Home Assistant action config, passed to the generic row    |
| `double_tap_action` | object | no       | Standard Home Assistant action config, passed to the generic row    |

The name and icon default to those of the `entity` (lower handle) when not set.

Values are formatted like the stock `input_number` row: decimal places come from each entity's own
`step`, then the user's number format setting, then that entity's unit.

The handles cannot be dragged past each other — the dragged one stops at the other rather than
pushing it — and a drag always writes the smaller value to `entity` and the larger to `range_entity`.
An inverted pair can therefore only be written from outside the card; when one is, the row shows the
values as the entities hold them, marked with an exclamation icon in the error colour and explained
on hover, rather than quietly presenting them the other way round. Set `warn_inverted: false` to
suppress that and have the row present the pair in order instead.

## Notes and limitations

- Only `input_number` entities are supported — updates are written with the
  `input_number.set_value` service.
- The card element registers as `range-entity-row`; the repository/file name is
  `ha-range-entities-slider` for historical reasons.
- **Requires internet access on first load.** The module imports Lit from
  `https://unpkg.com/lit@2/index.js?module` — the pattern used by the advanced example in the
  [official custom card docs](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/).
  The browser caches it afterwards, but the row will fail to load if unpkg is unreachable when a
  client first fetches it.
- This is an entity **row**, not a standalone card. It must live inside a card that accepts rows,
  such as the Entities card.

## Development

Task running uses [just](https://github.com/casey/just); `just` on its own lists the recipes.

| Recipe                | What it does                                                          |
| --------------------- | --------------------------------------------------------------------- |
| `just check`          | Parses the card as an ES module, validates `hacs.json`, flags version/tag drift |
| `just render [ver]`   | Renders the card in a real Home Assistant and checks it (`stable` by default)   |
| `just render-all`     | Renders against both Home Assistant `stable` and `beta`                |
| `just render-themes`  | Renders the row under the custom theme packs                           |
| `just fmt`            | Formats with prettier (`fmt-check` to verify only)                     |
| `just changelog`      | Shows the pending `[Unreleased]` entries                               |
| `just bump <level>`   | Promotes `[Unreleased]`, rewrites `VERSION`, commits, and tags         |
| `just release`        | Pushes the commit and tag, then creates the GitHub release             |
| `just publish <level>`| `bump` followed by `release`                                           |
| `just notes [version]`| Prints the notes recorded for a version                                |

### Render test

`just render` boots Home Assistant in Docker against a seeded config, completes onboarding through
the API, and drives Playwright to load the dashboard and check the row. Docker is the only host
requirement — the browser and Playwright itself live in the image built from
[tests/Dockerfile](tests/Dockerfile).

It checks that the row mounts, the slider is in range mode, `min`/`max`/`step` and both handles
follow the entities, and that the Material You patch actually lands inside `ha-slider`'s shadow
root. That last one matters most: the patch targets private ids (`#thumb-min`, `#thumb-max`,
`#indicator`) that upstream can rename at any time, which is why
[the workflow](.github/workflows/render.yml) runs it weekly against `stable` and `beta`.

Screenshots land in `tests/screenshots/` (gitignored, uploaded as CI artifacts) in light and dark,
and the test dashboard places the custom row directly above stock `input_number` slider rows for the
same entities, so each capture doubles as a side-by-side comparison.

```bash
just render              # Home Assistant stable
just render beta
KEEP_HA=1 just render    # leave HA up on http://localhost:8124 (render / render-password)
```

#### Custom themes

`just render-themes` additionally downloads these theme packs into the test config and screenshots
the row under a curated selection of them:

| Pack | Themes swept |
| ---- | ------------ |
| [card-mod](https://github.com/thomasloven/lovelace-card-mod) | none — a resource the packs below depend on |
| [material-you-theme](https://github.com/Nerwyn/material-you-theme) + [material-you-utilities](https://github.com/Nerwyn/material-you-utilities) | Material You |
| [catppuccin/home-assistant](https://github.com/catppuccin/home-assistant) | Catppuccin Latte, Catppuccin Mocha |
| [homeassistant-visionos-theme](https://github.com/Nezz/homeassistant-visionos-theme) | visionos, Liquid Glass |
| [Metrology-for-Hass](https://github.com/Madelena/Metrology-for-Hass) | Metro Blue, Fluent Slate |
| [graphite](https://github.com/TilmanGriesel/graphite) | Graphite, Graphite Light |
| [lovelace-ios-themes](https://github.com/basnijholt/lovelace-ios-themes) | ios-light-mode-light-blue, ios-dark-mode-dark-blue |
| [macOS-Theme](https://github.com/JuanMTech/macOS-Theme) | macOS Theme |

card-mod is installed as a dashboard resource, loaded before the theme modules and the card itself:
8 of the 12 installed theme files put styling behind `card-mod-theme` keys — 33 references in
Metrology alone, plus visionOS, Liquid Glass and every Graphite variant — and those styles silently
do nothing without it. The sweep asserts it registered.

The packs expand to 56 themes, so the sweep renders a representative pair per pack rather than every
accent colour, and skips the "Do Not Use" base themes the packs ship for inheritance. Each theme is
captured in light and dark only when that makes a difference: a theme that declares its colours
outright, or declares light and dark modes with identical values, is captured once and its screenshot
carries no mode suffix. That is decided by comparing how the theme actually resolves, not just what it
declares, and the run reports which themes were captured once.

```bash
just render-themes
ALL_THEMES=1 just render-themes                        # every installed theme
THEME_FILTER="Graphite,Catppuccin" just render-themes   # substring match
REFRESH_THEMES=1 just render-themes                     # ignore the download cache
```

Theme tarballs are cached in `tests/.theme-cache` (gitignored, refreshed weekly) so repeated runs do
not re-download them — unauthenticated GitHub allows only 60 API requests an hour. Set `GITHUB_TOKEN`
to raise that; CI passes one automatically.

It checks that the range handle gets a painted body under every theme swept, and fails if one does
not (`STRICT_THEMES=0` downgrades that to a warning). This is what caught the handles rendering as a
bare gap in the track under all seven non-Material-You packs: the styling depends on `--md-sys-*`
variables that only the material-you theme defines, and now falls back to `--primary-color` and
fixed sizes elsewhere.

**Every change documents itself.** Add entries under `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md) as part of the change, in the same commit. `just bump` promotes that
section to the new version with today's date and **refuses to run when it is empty**, and
`just release` uses that section as the GitHub release notes — so notes never come from raw commit
subjects.

The version lives in one place: the `VERSION` const in `ha-range-entities-slider.js`, which is also
printed to the browser console when the card loads. Tags are derived from it as `vX.Y.Z`.

```bash
# after editing the card and adding a CHANGELOG entry
just check
just bump minor    # patch | minor | major
just release
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
