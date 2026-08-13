# ha-range-entities-slider

[![HA stable](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/stable.yml/badge.svg)](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/stable.yml)
[![HA beta](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/beta.yml/badge.svg)](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/beta.yml)
[![Themes](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/themes.yml/badge.svg)](https://github.com/W-Floyd/ha-range-entities-slider/actions/workflows/themes.yml)

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

Building on the card, running the render tests against a real Home Assistant, the theme sweep, and
the release flow are all covered in [DEVELOPMENT.md](DEVELOPMENT.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
