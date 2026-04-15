/**
 * range-entity-row
 *
 * Extends the standard input_number entity row to display two input_number
 * entities as a single dual-handle range slider.
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

  // ── Styles ──────────────────────────────────────────────────────────────────

  const STYLES = `
    :host {
      display: flex;
      align-items: center;
      padding: 0 16px;
      min-height: 48px;
      box-sizing: border-box;
    }

    .icon {
      min-width: 40px;
      display: flex;
      align-items: center;
      color: var(--paper-item-icon-color, var(--primary-text-color));
    }

    .info {
      flex: 1 1 0;
      min-width: 0;
      padding-right: 16px;
    }

    .name {
      color: var(--primary-text-color);
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .control {
      display: flex;
      align-items: center;
      flex: 2 1 0;
      gap: 8px;
      min-width: 0;
    }

    /* ── Dual-handle slider ── */

    .slider-wrap {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      height: 28px;
      display: flex;
      align-items: center;
    }

    /* Inert background track */
    .track-bg {
      position: absolute;
      left: 0;
      right: 0;
      height: 4px;
      border-radius: 2px;
      background: var(--paper-slider-container-color,
                      var(--secondary-text-color, #ccc));
      pointer-events: none;
    }

    /* Highlighted segment between the two thumbs */
    .track-fill {
      position: absolute;
      height: 4px;
      border-radius: 2px;
      background: var(--slider-color, var(--primary-color));
      pointer-events: none;
    }

    input[type="range"] {
      position: absolute;
      width: 100%;
      height: 4px;
      margin: 0;
      padding: 0;
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      pointer-events: none;
      outline: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      pointer-events: all;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--slider-color, var(--primary-color));
      background: var(--card-background-color, white);
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,.3);
      transition: border-color 0.15s, transform 0.1s;
    }

    input[type="range"]::-moz-range-thumb {
      pointer-events: all;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid var(--slider-color, var(--primary-color));
      background: var(--card-background-color, white);
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,.3);
    }

    input[type="range"]:active::-webkit-slider-thumb {
      transform: scale(1.2);
      border-color: var(--primary-color);
    }

    /* The upper thumb sits on top; z-index swap when handles cross */
    .thumb-lower  { z-index: 2; }
    .thumb-upper  { z-index: 3; }
    .thumb-lower.on-top { z-index: 4; }

    /* ── Value labels ── */

    .values {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 44px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--primary-text-color);
      white-space: nowrap;
    }

    .value-lower { color: var(--secondary-text-color); }
    .value-upper { font-weight: 500; }
  `;

  // ── Element ──────────────────────────────────────────────────────────────────

  class RangeEntityRow extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = null;
      this._dragging = false;
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

    // ── Derived state ─────────────────────────────────────────────────────────

    _stateOf(entityId) {
      return this._hass?.states[entityId] ?? null;
    }

    _computeRange() {
      const lower = this._stateOf(this._config.entity);
      const upper = this._stateOf(this._config.range_entity);
      if (!lower || !upper) return null;

      // Use the broadest shared min/max from both entities' attributes
      const min  = Math.min(
        parseFloat(lower.attributes.min ?? 0),
        parseFloat(upper.attributes.min ?? 0),
      );
      const max  = Math.max(
        parseFloat(lower.attributes.max ?? 100),
        parseFloat(upper.attributes.max ?? 100),
      );
      const step = Math.min(
        parseFloat(lower.attributes.step ?? 1),
        parseFloat(upper.attributes.step ?? 1),
      );
      const lowerVal = parseFloat(lower.state);
      const upperVal = parseFloat(upper.state);
      const unit = lower.attributes.unit_of_measurement
                ?? upper.attributes.unit_of_measurement
                ?? '';

      return { min, max, step, lowerVal, upperVal, unit };
    }

    // ── Build DOM (once) ──────────────────────────────────────────────────────

    _build() {
      const style = document.createElement('style');
      style.textContent = STYLES;

      // Icon
      const iconWrap = document.createElement('div');
      iconWrap.className = 'icon';
      this._iconEl = document.createElement('ha-icon');
      iconWrap.appendChild(this._iconEl);

      // Name
      const info = document.createElement('div');
      info.className = 'info';
      this._nameEl = document.createElement('div');
      this._nameEl.className = 'name';
      info.appendChild(this._nameEl);

      // Slider wrapper
      const sliderWrap = document.createElement('div');
      sliderWrap.className = 'slider-wrap';

      this._trackBg   = document.createElement('div');
      this._trackBg.className = 'track-bg';

      this._trackFill = document.createElement('div');
      this._trackFill.className = 'track-fill';

      this._thumbLower = document.createElement('input');
      this._thumbLower.type = 'range';
      this._thumbLower.className = 'thumb-lower';

      this._thumbUpper = document.createElement('input');
      this._thumbUpper.type = 'range';
      this._thumbUpper.className = 'thumb-upper';

      sliderWrap.append(
        this._trackBg,
        this._trackFill,
        this._thumbLower,
        this._thumbUpper,
      );

      // Value labels
      const values = document.createElement('div');
      values.className = 'values';
      this._valueLower = document.createElement('div');
      this._valueLower.className = 'value-lower';
      this._valueUpper = document.createElement('div');
      this._valueUpper.className = 'value-upper';
      values.append(this._valueLower, this._valueUpper);

      // Control row
      const control = document.createElement('div');
      control.className = 'control';
      control.append(sliderWrap, values);

      this.shadowRoot.append(style, iconWrap, info, control);

      // ── Event listeners ──────────────────────────────────────────────────

      for (const thumb of [this._thumbLower, this._thumbUpper]) {
        thumb.addEventListener('pointerdown', () => { this._dragging = true; });
        thumb.addEventListener('pointerup',   () => { this._dragging = false; });
        thumb.addEventListener('pointercancel', () => { this._dragging = false; });
      }

      // Live feedback while dragging
      this._thumbLower.addEventListener('input', () => this._onLowerInput());
      this._thumbUpper.addEventListener('input', () => this._onUpperInput());

      // Commit on release
      this._thumbLower.addEventListener('change', () => {
        this._callService(this._config.entity, parseFloat(this._thumbLower.value));
      });
      this._thumbUpper.addEventListener('change', () => {
        this._callService(this._config.range_entity, parseFloat(this._thumbUpper.value));
      });
    }

    // ── Live input handlers ───────────────────────────────────────────────────

    _onLowerInput() {
      const lv = parseFloat(this._thumbLower.value);
      const uv = parseFloat(this._thumbUpper.value);
      // Prevent lower from crossing upper
      if (lv > uv) {
        this._thumbLower.value = uv;
      }
      this._refreshFillAndLabels();
    }

    _onUpperInput() {
      const lv = parseFloat(this._thumbLower.value);
      const uv = parseFloat(this._thumbUpper.value);
      // Prevent upper from crossing lower
      if (uv < lv) {
        this._thumbUpper.value = lv;
      }
      this._refreshFillAndLabels();
    }

    // ── Update DOM (on every hass change) ────────────────────────────────────

    _update() {
      if (!this._hass || !this._config || !this._initialized) return;

      const lower = this._stateOf(this._config.entity);
      const upper = this._stateOf(this._config.range_entity);
      const range = this._computeRange();
      if (!range) return;

      const { min, max, step, lowerVal, upperVal, unit } = range;

      // Icon
      const icon = this._config.icon
        ?? lower?.attributes.icon
        ?? upper?.attributes.icon
        ?? 'mdi:ray-vertex';
      this._iconEl.setAttribute('icon', icon);

      // Name
      const lowerName = lower?.attributes.friendly_name ?? this._config.entity;
      const upperName = upper?.attributes.friendly_name ?? this._config.range_entity;
      this._nameEl.textContent = this._config.name ?? `${lowerName} – ${upperName}`;

      // Sliders — skip if user is currently dragging
      if (!this._dragging) {
        for (const thumb of [this._thumbLower, this._thumbUpper]) {
          thumb.min  = min;
          thumb.max  = max;
          thumb.step = step;
        }
        this._thumbLower.value = Math.min(lowerVal, upperVal);
        this._thumbUpper.value = Math.max(lowerVal, upperVal);
        this._refreshFillAndLabels(unit);
      }
    }

    _refreshFillAndLabels(unit) {
      const min = parseFloat(this._thumbLower.min);
      const max = parseFloat(this._thumbLower.max);
      const lv  = parseFloat(this._thumbLower.value);
      const uv  = parseFloat(this._thumbUpper.value);

      // Clamp so the fill never goes outside the track
      const span = max - min || 1;
      const leftPct  = ((lv - min) / span) * 100;
      const rightPct = ((uv - min) / span) * 100;

      this._trackFill.style.left  = `${leftPct}%`;
      this._trackFill.style.width = `${rightPct - leftPct}%`;

      // Swap z-index so whichever thumb is near the left edge is on top
      // (makes it grabbable when both handles are at the minimum)
      if (leftPct > 50) {
        this._thumbLower.classList.add('on-top');
      } else {
        this._thumbLower.classList.remove('on-top');
      }

      const resolvedUnit = unit
        ?? this._stateOf(this._config.entity)?.attributes.unit_of_measurement
        ?? '';

      this._valueLower.textContent = `${lv}${resolvedUnit}`;
      this._valueUpper.textContent = `${uv}${resolvedUnit}`;
    }

    // ── HA service call ───────────────────────────────────────────────────────

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
