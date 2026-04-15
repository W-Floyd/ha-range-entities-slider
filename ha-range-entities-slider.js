(() => {
  'use strict';

  const STYLES = `
    :host {
      display: flex;
      align-items: center;
      padding: 0 16px;
      min-height: 48px;
    }
    .icon {
      min-width: 40px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      color: var(--paper-item-icon-color, var(--primary-text-color));
    }
    .info {
      flex: 1 1 0;
      min-width: 0;
      padding-right: 8px;
    }
    .name {
      color: var(--primary-text-color);
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .control {
      display: flex;
      align-items: center;
      flex: 2 1 0;
      gap: 8px;
      min-width: 0;
    }
    input[type="range"] {
      flex: 1 1 0;
      min-width: 0;
      cursor: pointer;
      accent-color: var(--slider-color, var(--primary-color));
    }
    input[type="range"]:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .value-display {
      min-width: 48px;
      text-align: right;
      color: var(--primary-text-color);
      font-size: 14px;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    .value-input {
      width: 56px;
      text-align: right;
      font-size: 14px;
      border: none;
      border-bottom: 1px solid var(--primary-color);
      background: transparent;
      color: var(--primary-text-color);
      outline: none;
      padding: 0;
    }
    .bound-indicator {
      font-size: 11px;
      color: var(--secondary-text-color);
      white-space: nowrap;
    }
  `;

  class RangeEntityRow extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = null;
      this._dragging = false;
      this._editing = false;
      this._initialized = false;
      this.attachShadow({ mode: 'open' });
    }

    setConfig(config) {
      if (!config.entity) {
        throw new Error('[range-entity-row] "entity" is required');
      }
      if (config.bound_entity && !['min', 'max'].includes(config.bound_type)) {
        throw new Error('[range-entity-row] "bound_type" must be "min" or "max" when bound_entity is set');
      }
      this._config = config;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._initialized) {
        this._buildDOM();
        this._initialized = true;
      }
      this._updateDOM();
    }

    // --- Compute effective min/max/step/value from entity + bound ---

    _computeBounds() {
      const entity = this._hass.states[this._config.entity];
      if (!entity) return null;

      const attrMin = parseFloat(entity.attributes.min ?? 0);
      const attrMax = parseFloat(entity.attributes.max ?? 100);
      const step    = parseFloat(entity.attributes.step ?? 1);
      const value   = parseFloat(entity.state);

      let sliderMin = attrMin;
      let sliderMax = attrMax;
      let boundValue = null;

      if (this._config.bound_entity) {
        const boundEntity = this._hass.states[this._config.bound_entity];
        if (boundEntity) {
          boundValue = parseFloat(boundEntity.state);
          if (this._config.bound_type === 'max') {
            sliderMax = Math.min(attrMax, boundValue);
          } else {
            sliderMin = Math.max(attrMin, boundValue);
          }
        }
      }

      // Ensure min <= max
      if (sliderMin > sliderMax) sliderMin = sliderMax;

      return { min: sliderMin, max: sliderMax, step, value, boundValue };
    }

    // --- Build DOM once ---

    _buildDOM() {
      const style = document.createElement('style');
      style.textContent = STYLES;

      const iconSlot = document.createElement('div');
      iconSlot.className = 'icon';
      this._iconEl = document.createElement('ha-icon');
      iconSlot.appendChild(this._iconEl);

      const info = document.createElement('div');
      info.className = 'info';
      this._nameEl = document.createElement('div');
      this._nameEl.className = 'name';
      this._boundIndicatorEl = document.createElement('div');
      this._boundIndicatorEl.className = 'bound-indicator';
      info.appendChild(this._nameEl);
      info.appendChild(this._boundIndicatorEl);

      const control = document.createElement('div');
      control.className = 'control';

      this._slider = document.createElement('input');
      this._slider.type = 'range';

      this._valueDisplay = document.createElement('div');
      this._valueDisplay.className = 'value-display';

      control.appendChild(this._slider);
      control.appendChild(this._valueDisplay);

      this.shadowRoot.appendChild(style);
      this.shadowRoot.appendChild(iconSlot);
      this.shadowRoot.appendChild(info);
      this.shadowRoot.appendChild(control);

      // --- Event listeners ---

      this._slider.addEventListener('pointerdown', () => {
        this._dragging = true;
      });

      this._slider.addEventListener('pointerup', () => {
        this._dragging = false;
      });

      this._slider.addEventListener('pointercancel', () => {
        this._dragging = false;
      });

      // Live display while dragging
      this._slider.addEventListener('input', () => {
        const entity = this._hass?.states[this._config.entity];
        const unit = entity?.attributes.unit_of_measurement ?? '';
        this._valueDisplay.textContent = `${this._slider.value}${unit}`;
      });

      // Commit to HA on release
      this._slider.addEventListener('change', () => {
        this._callService(parseFloat(this._slider.value));
      });

      // Tap value to edit inline
      this._valueDisplay.addEventListener('click', () => {
        if (this._editing) return;
        this._editing = true;

        const bounds = this._computeBounds();
        if (!bounds) return;

        const entity = this._hass?.states[this._config.entity];
        const unit = entity?.attributes.unit_of_measurement ?? '';
        const currentVal = Math.min(bounds.max, Math.max(bounds.min, bounds.value));

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'value-input';
        input.min = bounds.min;
        input.max = bounds.max;
        input.step = bounds.step;
        input.value = currentVal;

        const commit = () => {
          const parsed = parseFloat(input.value);
          if (!isNaN(parsed)) {
            const clamped = Math.min(bounds.max, Math.max(bounds.min, parsed));
            this._callService(clamped);
          }
          this._editing = false;
          this._updateDOM();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') {
            this._editing = false;
            this._updateDOM();
          }
        });

        this._valueDisplay.textContent = '';
        this._valueDisplay.appendChild(input);
        input.focus();
        input.select();
      });
    }

    // --- Update DOM values without rebuilding ---

    _updateDOM() {
      if (!this._hass || !this._config || !this._initialized) return;

      const entity = this._hass.states[this._config.entity];
      if (!entity) {
        this._nameEl.textContent = `Entity not found: ${this._config.entity}`;
        this._slider.disabled = true;
        return;
      }

      const bounds = this._computeBounds();
      if (!bounds) return;

      const { min, max, step, value, boundValue } = bounds;
      const unit = entity.attributes.unit_of_measurement ?? '';
      const name = this._config.name ?? entity.attributes.friendly_name ?? this._config.entity;
      const icon = this._config.icon ?? entity.attributes.icon ?? 'mdi:ray-vertex';

      // Icon
      this._iconEl.setAttribute('icon', icon);

      // Name
      this._nameEl.textContent = name;

      // Bound indicator
      if (this._config.bound_entity && boundValue !== null) {
        const boundEntity = this._hass.states[this._config.bound_entity];
        const boundName = this._config.bound_type === 'max' ? 'max' : 'min';
        const boundLabel = boundEntity?.attributes.friendly_name ?? this._config.bound_entity;
        this._boundIndicatorEl.textContent = `${boundName}: ${boundValue}${unit} (${boundLabel})`;
      } else {
        this._boundIndicatorEl.textContent = '';
      }

      // Slider — only update if user isn't currently dragging or editing inline
      if (!this._dragging && !this._editing) {
        const clamped = Math.min(max, Math.max(min, value));

        this._slider.min   = min;
        this._slider.max   = max;
        this._slider.step  = step;
        this._slider.value = clamped;
        this._slider.disabled = (min >= max);

        this._valueDisplay.textContent = `${clamped}${unit}`;
      }
    }

    // --- Call HA service ---

    _callService(value) {
      this._hass.callService('input_number', 'set_value', {
        entity_id: this._config.entity,
        value,
      });
    }
  }

  customElements.define('range-entity-row', RangeEntityRow);

  // Announce to HA that this is a custom card (helps with resource loading detection)
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'range-entity-row',
    name: 'Range Entity Row',
    description: 'An input_number entity row whose slider is dynamically bounded by a second entity.',
  });

  console.info(
    '%c RANGE-ENTITY-ROW %c Loaded ',
    'color: white; background: #4caf50; font-weight: bold; padding: 2px 4px; border-radius: 3px 0 0 3px;',
    'color: #4caf50; background: #f0f0f0; font-weight: bold; padding: 2px 4px; border-radius: 0 3px 3px 0;',
  );
})();
