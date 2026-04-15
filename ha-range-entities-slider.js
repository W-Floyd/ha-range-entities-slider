/**
 * range-entity-row
 *
 * Displays two input_number entities as a single dual-handle range slider,
 * using the same hui-generic-entity-row wrapper and ha-slider component
 * that hui-input-number-entity-row uses — inheriting all HA styling.
 *
 * Config (inside an entities card):
 *
 *   - type: custom:range-entity-row
 *     entity: input_number.lower_temp      # lower handle
 *     range_entity: input_number.upper_temp # upper handle
 *     name: Temperature Range              # optional
 *     icon: mdi:thermometer                # optional
 */
(() => {
  'use strict';

  // Exact styles from hui-input-number-entity-row
  const STYLES = `
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
  `;

  class RangeEntityRow extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = null;
      this._interacting = false;
      this._initialized = false;
      this.attachShadow({ mode: 'open' });
    }

    // ── Config ────────────────────────────────────────────────────────────────

    setConfig(config) {
      if (!config.entity) {
        throw new Error('[range-entity-row] "entity" is required (lower handle)');
      }
      if (!config.range_entity) {
        throw new Error('[range-entity-row] "range_entity" is required (upper handle)');
      }
      this._config = config;
      if (this._rowEl) {
        this._rowEl.config = this._buildRowConfig();
      }
    }

    // ── hass ──────────────────────────────────────────────────────────────────

    set hass(hass) {
      this._hass = hass;
      if (!this._initialized) {
        this._build();
        this._initialized = true;
      }
      this._update();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _buildRowConfig() {
      // Pass only the fields hui-generic-entity-row understands
      const cfg = { entity: this._config.entity };
      if (this._config.name !== undefined) cfg.name = this._config.name;
      if (this._config.icon !== undefined) cfg.icon = this._config.icon;
      if (this._config.tap_action !== undefined) cfg.tap_action = this._config.tap_action;
      if (this._config.hold_action !== undefined) cfg.hold_action = this._config.hold_action;
      if (this._config.double_tap_action !== undefined) cfg.double_tap_action = this._config.double_tap_action;
      return cfg;
    }

    _computeRange() {
      const lower = this._hass.states[this._config.entity];
      const upper = this._hass.states[this._config.range_entity];
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
        lower,
        upper,
      };
    }

    // ── Build DOM (once) ──────────────────────────────────────────────────────

    _build() {
      const style = document.createElement('style');
      style.textContent = STYLES;

      // hui-generic-entity-row handles the icon, name, and row layout —
      // the same element hui-input-number-entity-row uses
      this._rowEl = document.createElement('hui-generic-entity-row');

      // .flex + ha-slider + .state mirrors hui-input-number-entity-row exactly
      const flex = document.createElement('div');
      flex.className = 'flex';

      this._slider = document.createElement('ha-slider');
      this._slider.setAttribute('range', '');

      this._stateEl = document.createElement('span');
      this._stateEl.className = 'state';

      flex.append(this._slider, this._stateEl);
      this._rowEl.appendChild(flex);
      this.shadowRoot.append(style, this._rowEl);

      // Track active interaction so hass updates don't snap the slider mid-drag
      this._slider.addEventListener('input', () => {
        this._interacting = true;
      });

      this._slider.addEventListener('change', () => {
        this._interacting = false;
        this._onSliderChange();
      });
    }

    // ── Update DOM on each hass change ────────────────────────────────────────

    _update() {
      if (!this._hass || !this._config || !this._initialized) return;

      this._rowEl.hass = this._hass;
      this._rowEl.config = this._buildRowConfig();

      const range = this._computeRange();
      if (!range) return;

      const { min, max, step, lowerVal, upperVal, lower, upper } = range;

      if (!this._interacting) {
        this._slider.min = min;
        this._slider.max = max;
        this._slider.step = step;
        this._slider.minValue = Math.min(lowerVal, upperVal);
        this._slider.maxValue = Math.max(lowerVal, upperVal);
      }

      // State label: "20–25 °C"  (mirrors hass.formatEntityState on each entity)
      const fmt = (stateObj) =>
        this._hass.formatEntityState?.(stateObj) ?? stateObj.state;
      this._stateEl.textContent = `${fmt(lower)}–${fmt(upper)}`;
    }

    // ── Commit changed values to HA ───────────────────────────────────────────

    _onSliderChange() {
      const lower = this._hass?.states[this._config.entity];
      const upper = this._hass?.states[this._config.range_entity];

      if (lower && this._slider.minValue !== parseFloat(lower.state)) {
        this._callService(this._config.entity, this._slider.minValue);
      }
      if (upper && this._slider.maxValue !== parseFloat(upper.state)) {
        this._callService(this._config.range_entity, this._slider.maxValue);
      }
    }

    _callService(entityId, value) {
      this._hass.callService('input_number', 'set_value', {
        entity_id: entityId,
        value,
      });
    }
  }

  customElements.define('range-entity-row', RangeEntityRow);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'range-entity-row',
    name: 'Range Entity Row',
    description: 'Two input_number entities as a single dual-handle range slider.',
  });

  console.info(
    '%c RANGE-ENTITY-ROW %c Loaded ',
    'color:#fff;background:#4caf50;font-weight:bold;padding:2px 4px;border-radius:3px 0 0 3px',
    'color:#4caf50;background:#f0f0f0;font-weight:bold;padding:2px 4px;border-radius:0 3px 3px 0',
  );
})();
