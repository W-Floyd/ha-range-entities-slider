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

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (!this.hass || !this.config) return html``;
    const range = this._computeRange();
    if (!range) return html``;

    const { min, max, step, unit } = range;
    const fmt = (v) => `${v}${unit ? `\u00a0${unit}` : ""}`;

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
          <span class="state"
            >${fmt(this._lowerVal)}<br />${fmt(this._upperVal)}</span
          >
        </div>
      </hui-generic-entity-row>
    `;
  }

  _fixMaterialYouRangeSlider() {
    try {
      const slider = this.shadowRoot?.querySelector("ha-slider");
      if (!slider?.hasAttribute("range")) return;

      setTimeout(() => {
        const sliderShadow = slider.shadowRoot;
        if (!sliderShadow) return;

        if (!sliderShadow.querySelector("#range-slider-fix")) {
          const style = document.createElement("style");
          style.id = "range-slider-fix";
          style.textContent = `
            /* Apply same thumb styling to range slider thumbs */
            :host([range]) #thumb-min,
            :host([range]) #thumb-max {
              overflow: visible;
              background: var(--ha-slider-thumb-negative-color);
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
            }
          `;
          sliderShadow.appendChild(style);
        }
      }, 50);
    } catch (e) {
      console.debug("Could not fix material-you range slider:", e);
    }
  }

  // ── Slider events ───────────────────────────────────────────────────────────

  _onInput(ev) {
    this._interacting = true;
    this._lowerVal = ev.target.minValue;
    this._upperVal = ev.target.maxValue;
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
      ha-slider {
        width: 100%;
        max-width: 200px;
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
  "%c RANGE-ENTITY-ROW %c Loaded ",
  "color:#fff;background:#4caf50;font-weight:bold;padding:2px 4px;border-radius:3px 0 0 3px",
  "color:#4caf50;background:#f0f0f0;font-weight:bold;padding:2px 4px;border-radius:0 3px 3px 0",
);
