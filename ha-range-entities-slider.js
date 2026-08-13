/**
 * range-entity-row
 *
 * Displays two input_number entities as a dual-slider entity row.
 * Each slider is modeled exactly on hui-input-number-entity-row.
 *
 * Config (inside an entities card):
 *
 *   - type: custom:range-entity-row
 *     entity: input_number.lower_temp      # lower handle
 *     range_entity: input_number.upper_temp # upper handle
 *     name: Temperature Range              # optional
 *     icon: mdi:thermometer                # optional
 */
import { LitElement, html, css } from "https://unpkg.com/lit@2/index.js?module";

// Single source of truth for the version; bumped by `just bump`.
const VERSION = "0.1.0";

class RangeEntityRow extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _lowerVal: { state: true },
      _upperVal: { state: true },
    };
  }

  constructor() {
    super();
    this._lowerVal = 0;
    this._upperVal = 0;
    this._interacting = false;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  setConfig(config) {
    if (!config.entity) {
      throw new Error('[range-entity-row] "entity" is required (lower handle)');
    }
    if (!config.range_entity) {
      throw new Error(
        '[range-entity-row] "range_entity" is required (upper handle)',
      );
    }
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  updated(changedProps) {
    if (changedProps.has("hass")) {
      const range = this._computeRange();
      if (!range) return;
      if (!this._interacting) {
        this._lowerVal = Math.min(range.lowerVal, range.upperVal);
        this._upperVal = Math.max(range.lowerVal, range.upperVal);
      }

      // The handles cannot be dragged past each other, so an inverted pair
      // means something outside the card wrote it. The row still presents the
      // values low-to-high, and a drag writes them back in order, but say so
      // rather than hiding it — the entities may not mean what they look like.
      if (range.lowerVal > range.upperVal) {
        const pair = `${range.lowerVal}/${range.upperVal}`;
        if (this._warnedInverted !== pair) {
          this._warnedInverted = pair;
          console.warn(
            `[range-entity-row] ${this.config.entity} (${range.lowerVal}) is above ` +
              `${this.config.range_entity} (${range.upperVal}); showing them ` +
              `low-to-high. A drag will write them back in order.`,
          );
        }
      } else {
        this._warnedInverted = undefined;
      }
    }

    // Fix material-you theme compatibility for range sliders
    // Run this on every update to ensure it stays applied
    this._fixMaterialYouRangeSlider();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _computeRange() {
    if (!this.hass || !this.config) return null;
    const lower = this.hass.states[this.config.entity];
    const upper = this.hass.states[this.config.range_entity];
    if (!lower || !upper) return null;

    return {
      min: Math.min(
        parseFloat(lower.attributes.min ?? 0),
        parseFloat(upper.attributes.min ?? 0),
      ),
      max: Math.max(
        parseFloat(lower.attributes.max ?? 100),
        parseFloat(upper.attributes.max ?? 100),
      ),
      step: Math.min(
        parseFloat(lower.attributes.step ?? 1),
        parseFloat(upper.attributes.step ?? 1),
      ),
      lowerVal: parseFloat(lower.state),
      upperVal: parseFloat(upper.state),
      unit:
        lower.attributes.unit_of_measurement ??
        upper.attributes.unit_of_measurement ??
        "",
    };
  }

  _buildRowConfig() {
    const cfg = { entity: this.config.entity };
    if (this.config.name !== undefined) cfg.name = this.config.name;
    if (this.config.icon !== undefined) cfg.icon = this.config.icon;
    if (this.config.tap_action !== undefined)
      cfg.tap_action = this.config.tap_action;
    if (this.config.hold_action !== undefined)
      cfg.hold_action = this.config.hold_action;
    if (this.config.double_tap_action !== undefined)
      cfg.double_tap_action = this.config.double_tap_action;
    return cfg;
  }

  // ── Value formatting ────────────────────────────────────────────────────────

  /**
   * The locales Home Assistant formats numbers with, derived from the user's
   * number format preference. Mirrors the frontend's own mapping so the readout
   * reads like the stock rows; null is HA's "none", meaning no localisation.
   */
  _numberFormatLocale() {
    const locale = this.hass?.locale;
    switch (locale?.number_format) {
      case "comma_decimal":
        return ["en-US", "en"];
      case "decimal_comma":
        return ["de", "es", "it"];
      case "space_comma":
        return ["fr", "sv", "cs"];
      case "system":
        return undefined;
      case "none":
        return null;
      default:
        return locale?.language;
    }
  }

  /**
   * Formats one entity's value the way its stock row would: decimal places from
   * that entity's own step, the user's locale number format, then its own unit.
   */
  _formatValue(entityId, value) {
    const attributes = this.hass?.states[entityId]?.attributes ?? {};
    const step = parseFloat(attributes.step);
    const decimals = Number.isFinite(step)
      ? (String(step).split(".")[1] ?? "").length
      : 0;

    const locale = this._numberFormatLocale();
    const number =
      locale === null
        ? value.toFixed(decimals)
        : new Intl.NumberFormat(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }).format(value);

    const unit = attributes.unit_of_measurement;
    return `${number}${unit ? ` ${unit}` : ""}`;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (!this.hass || !this.config) return html``;
    const range = this._computeRange();
    if (!range) return html``;

    const { min, max, step } = range;

    // An inverted pair can only come from outside the card, since the handles
    // cannot be dragged past each other. The slider itself has to be given the
    // values in order, but the readout shows them as the entities actually hold
    // them, flagged, rather than quietly presenting them the other way round.
    const inverted =
      !this._interacting &&
      range.lowerVal > range.upperVal &&
      this.config.warn_inverted !== false;
    const lower = this._formatValue(
      this.config.entity,
      inverted ? range.lowerVal : this._lowerVal,
    );
    const upper = this._formatValue(
      this.config.range_entity,
      inverted ? range.upperVal : this._upperVal,
    );
    const invertedTitle = inverted
      ? `${this.config.entity} (${lower}) is above ` +
        `${this.config.range_entity} (${upper}). The slider shows them in ` +
        `order; dragging it writes them back in order.`
      : undefined;

    return html`
      <hui-generic-entity-row
        .hass=${this.hass}
        .config=${this._buildRowConfig()}
      >
        <div class="flex">
          <ha-slider
            labeled
            range
            .min=${min}
            .max=${max}
            .step=${step}
            .minValue=${this._lowerVal}
            .maxValue=${this._upperVal}
            @input=${this._onInput}
            @change=${this._onChange}
          ></ha-slider>
          ${inverted
            ? html`<ha-icon
                class="inverted-warning"
                icon="mdi:alert-circle"
                title=${invertedTitle}
              ></ha-icon>`
            : ""}
          <span class="state ${inverted ? "inverted-warning" : ""}"
            >${lower}<br />${upper}</span
          >
        </div>
      </hui-generic-entity-row>
    `;
  }

  /**
   * Home Assistant does not paint handles on a range slider at all — with no
   * styling of our own the handles show only as gaps in the track. What they
   * should look like depends on the active theme, so pick per theme:
   *
   * - material-you: vertical bars, matching that theme's own slider handles.
   * - everything else: a round knob, matching the stock input_number row.
   */
  _rangeSliderThumbCss(materialYou) {
    if (materialYou) {
      return `
        /* Apply same thumb styling to range slider thumbs */
        :host([range]) #thumb-min,
        :host([range]) #thumb-max {
          overflow: visible;
          background: var(--ha-slider-thumb-negative-color);
          /* The stock thumb is a square-cornered rectangle in this colour: it
             punches the gap through the track either side of the handle.
             Rounding it here curves the gap inwards, which reads as the
             neighbouring segments being cut concave. */
          border-radius: 0;
          transition:
            width var(--md-sys-motion-expressive-spatial-default),
            left var(--md-sys-motion-expressive-spatial-default);
        }
        :host([range]) #thumb-min::before,
        :host([range]) #thumb-max::before {
          content: '';
          position: absolute;
          height: var(--thumb-actual-height);
          width: 4px;
          top: calc(-0.5 * (var(--thumb-actual-height) - var(--ha-slider-track-size)));
          left: 50%;
          transform: translateX(-50%);
          border-radius: var(--md-sys-shape-corner-full);
          background: var(--md-sys-color-primary);
        }
        :host([range]) #indicator::after {
          display: none !important;
        }
        :host([range]) #indicator {
          margin-inline-end: 0 !important;
          box-shadow: none !important;
          /* The base component rounds the indicator 8px on its outer end and
             2px on the end that faces the thumb. In range mode both ends face a
             thumb, so both take the 2px, instead of a square edge against the
             handle. */
          border-radius: 2px !important;
        }
      `;
    }

    /* Match the knob on a stock input_number slider row. The thumb element is
       already sized by Home Assistant exactly as the stock knob is, so painting
       it directly — rather than drawing a shape over it — keeps the two in step
       through upstream sizing changes and the slider's size variants.
       --slider-color is what the stock knob and the indicator use. */
    return `
      :host([range]) #thumb-min,
      :host([range]) #thumb-max {
        background: var(--slider-color, var(--primary-color, #03a9f4));
        border-radius: 50%;
        /* Range thumbs carry a 1px white border that the stock knob does not.
           With border-box sizing it eats into the same 16px, leaving a white
           ring around a smaller dot. */
        border: none;
      }
    `;
  }

  _fixMaterialYouRangeSlider() {
    try {
      const slider = this.shadowRoot?.querySelector("ha-slider");
      if (!slider?.hasAttribute("range")) return;

      setTimeout(() => {
        const sliderShadow = slider.shadowRoot;
        if (!sliderShadow) return;

        // The theme can change while the card is live, so the variant is
        // recorded and the style replaced when it no longer matches.
        const materialYou = !!getComputedStyle(this)
          .getPropertyValue("--md-sys-color-primary")
          .trim();
        const variant = materialYou ? "material-you" : "default";

        const existing = sliderShadow.querySelector("#range-slider-fix");
        if (existing?.dataset.variant === variant) return;
        existing?.remove();

        const style = document.createElement("style");
        style.id = "range-slider-fix";
        style.dataset.variant = variant;
        style.textContent = this._rangeSliderThumbCss(materialYou);
        sliderShadow.appendChild(style);
      }, 50);
    } catch (e) {
      console.debug("Could not style the range slider thumbs:", e);
    }
  }

  // ── Slider events ───────────────────────────────────────────────────────────

  _onInput(ev) {
    const slider = ev.target;
    const previousLower = this._lowerVal;
    const previousUpper = this._upperVal;
    let lower = slider.minValue;
    let upper = slider.maxValue;

    // ha-slider pushes the stationary handle along when the dragged one reaches
    // it. Stop the dragged handle at the other instead: if both moved, the one
    // that did not lead the move gets pinned back where it was.
    if (this._interacting && lower !== previousLower && upper !== previousUpper) {
      if (lower > previousLower) {
        lower = previousUpper;
        upper = previousUpper;
      } else {
        upper = previousLower;
        lower = previousLower;
      }
      slider.minValue = lower;
      slider.maxValue = upper;
    }

    this._interacting = true;
    this._lowerVal = lower;
    this._upperVal = upper;
  }

  _onChange(ev) {
    this._interacting = false;
    const lower = this.hass?.states[this.config.entity];
    const upper = this.hass?.states[this.config.range_entity];
    if (lower && ev.target.minValue !== parseFloat(lower.state)) {
      this._callService(this.config.entity, ev.target.minValue);
    }
    if (upper && ev.target.maxValue !== parseFloat(upper.state)) {
      this._callService(this.config.range_entity, ev.target.maxValue);
    }
  }

  // ── HA service call ─────────────────────────────────────────────────────────

  _callService(entityId, value) {
    this.hass.callService("input_number", "set_value", {
      entity_id: entityId,
      value,
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  static get styles() {
    return css`
      :host {
        display: block;
      }
      .flex {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-grow: 2;
      }
      .state {
        min-width: 45px;
        text-align: end;
      }
      .inverted-warning {
        color: var(--error-color, #db4437);
      }
      ha-icon.inverted-warning {
        --mdc-icon-size: 20px;
        margin-inline-end: 4px;
        flex: none;
      }
      ha-slider {
        width: 100%;
        max-width: 200px;
        /* Same gutters the stock input_number row gives its slider, so the
           track lines up with the rows above and below it. */
        margin: 1px 8px;
      }
      /* Override material-you styles for range sliders */
      ha-slider::part(indicator) {
        margin-inline-end: 0 !important;
        box-shadow: none !important;
      }
    `;
  }
}

customElements.define("range-entity-row", RangeEntityRow);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "range-entity-row",
  name: "Range Entity Row",
  description: "Two input_number entities as a dual-slider entity row.",
});

console.info(
  `%c RANGE-ENTITY-ROW %c ${VERSION} `,
  "color:#fff;background:#4caf50;font-weight:bold;padding:2px 4px;border-radius:3px 0 0 3px",
  "color:#4caf50;background:#f0f0f0;font-weight:bold;padding:2px 4px;border-radius:0 3px 3px 0",
);
