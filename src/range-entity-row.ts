/**
 * range-entity-row
 *
 * Renders two input_number or number entities as one dual-handle range slider,
 * modelled on Home Assistant's own hui-input-number-entity-row.
 *
 * Config (inside an entities card):
 *
 *   - type: custom:range-entity-row
 *     entity: input_number.lower_temp       # lower handle
 *     range_entity: input_number.upper_temp # upper handle
 *     name: Temperature Range               # optional
 *     icon: mdi:thermometer                 # optional
 *     warn_inverted: false                  # optional
 */
import type { HomeAssistant } from "custom-card-helpers";
import type { HassEntity } from "home-assistant-js-websocket";
import { LitElement, html, css, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import "./editor.js";
import { RANGE_SLIDER_STYLE_ID, thumbCss } from "./thumb-styles.js";
import type {
  GenericRowConfig,
  Range,
  RangeEntityRowConfig,
  RangeSlider,
} from "./types.js";

/** Single source of truth for the version; bumped by `just bump`. */
export const VERSION = "1.0.1";

const SUPPORTED_DOMAINS = ["input_number", "number"];

export class RangeEntityRow extends LitElement {
  /**
   * The visual editor Home Assistant opens for this row, resolved the same way
   * a card's is: hui-row-element-editor looks up the row class and calls this.
   */
  static getConfigElement(): HTMLElement {
    return document.createElement("range-entity-row-editor");
  }

  /** What the editor starts from when the row is added without a config. */
  static getStubConfig(): Partial<RangeEntityRowConfig> {
    return { entity: "", range_entity: "" };
  }

  static override get properties() {
    return {
      hass: {},
      config: {},
      _lowerVal: { state: true },
      _upperVal: { state: true },
    };
  }

  hass?: HomeAssistant;

  config?: RangeEntityRowConfig;

  private _lowerVal = 0;

  private _upperVal = 0;

  private _interacting = false;

  private _warnedInverted?: string;

  // ── Config ──────────────────────────────────────────────────────────────────

  setConfig(config: RangeEntityRowConfig): void {
    if (!config.entity) {
      throw new Error('[range-entity-row] "entity" is required (lower handle)');
    }
    if (!config.range_entity) {
      throw new Error(
        '[range-entity-row] "range_entity" is required (upper handle)',
      );
    }
    // input_number and number both carry min/max/step and take set_value, so
    // both work; anything else would render but never write.
    for (const [key, entityId] of [
      ["entity", config.entity],
      ["range_entity", config.range_entity],
    ] as const) {
      const domain = entityId.split(".")[0] ?? "";
      if (!SUPPORTED_DOMAINS.includes(domain)) {
        throw new Error(
          `[range-entity-row] "${key}" must be an input_number or number ` +
            `entity, got ${entityId}`,
        );
      }
    }
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  override updated(changedProps: PropertyValues): void {
    if (changedProps.has("hass")) {
      const range = this._computeRange();
      if (!range) return;
      if (!this._interacting) {
        // An unavailable entity parses to NaN, and Math.min/max would spread
        // that to both handles; fall back to the range's own bounds.
        const values = [range.lowerVal, range.upperVal].filter(Number.isFinite);
        this._lowerVal = values.length ? Math.min(...values) : range.min;
        this._upperVal = values.length ? Math.max(...values) : range.max;
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
            `[range-entity-row] ${this.config?.entity} (${range.lowerVal}) is ` +
              `above ${this.config?.range_entity} (${range.upperVal}); showing ` +
              `them low-to-high. A drag will write them back in order.`,
          );
        }
      } else {
        this._warnedInverted = undefined;
      }
    }

    this._styleRangeSliderThumbs();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Entities the config names that Home Assistant does not know about. */
  private _missingEntities(): string[] {
    if (!this.hass || !this.config) return [];
    return [this.config.entity, this.config.range_entity].filter(
      (entityId) => !this.hass?.states[entityId],
    );
  }

  /** An entity whose state is not a number cannot drive a slider. */
  private _isNumeric(entityId: string): boolean {
    const state = this.hass?.states[entityId]?.state;
    return state !== undefined && Number.isFinite(parseFloat(state));
  }

  private _computeRange(): Range | null {
    if (!this.hass || !this.config) return null;
    const lower = this.hass.states[this.config.entity];
    const upper = this.hass.states[this.config.range_entity];
    if (!lower || !upper) return null;

    const attr = (stateObj: HassEntity, key: string, fallback: number) =>
      parseFloat(String(stateObj.attributes[key] ?? fallback));

    return {
      min: Math.min(attr(lower, "min", 0), attr(upper, "min", 0)),
      max: Math.max(attr(lower, "max", 100), attr(upper, "max", 100)),
      step: Math.min(attr(lower, "step", 1), attr(upper, "step", 1)),
      lowerVal: parseFloat(lower.state),
      upperVal: parseFloat(upper.state),
      unit:
        lower.attributes.unit_of_measurement ??
        upper.attributes.unit_of_measurement ??
        "",
    };
  }

  private _buildRowConfig(): GenericRowConfig {
    const config = this.config!;
    const rowConfig: GenericRowConfig = { entity: config.entity };
    if (config.name !== undefined) rowConfig.name = config.name;
    if (config.icon !== undefined) rowConfig.icon = config.icon;
    if (config.tap_action !== undefined)
      rowConfig.tap_action = config.tap_action;
    if (config.hold_action !== undefined)
      rowConfig.hold_action = config.hold_action;
    if (config.double_tap_action !== undefined)
      rowConfig.double_tap_action = config.double_tap_action;
    return rowConfig;
  }

  // ── Value formatting ────────────────────────────────────────────────────────

  /**
   * The locales Home Assistant formats numbers with, derived from the user's
   * number format preference. Mirrors the frontend's own mapping so the readout
   * reads like the stock rows; null is HA's "none", meaning no localisation.
   */
  private _numberFormatLocale(): string | string[] | undefined | null {
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
  private _formatValue(entityId: string, value: number): string {
    const attributes = this.hass?.states[entityId]?.attributes ?? {};
    const step = parseFloat(String(attributes.step));
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
    return `${number}${unit ? ` ${unit}` : ""}`;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this.config) return nothing;

    // A row that renders nothing is indistinguishable from one that is not
    // there, so say what is wrong, as the stock rows do for the same case.
    const missing = this._missingEntities();
    if (missing.length) {
      const message =
        this.hass.localize?.(
          "ui.panel.lovelace.warning.entity_not_found",
          "entity",
          missing.join(", "),
        ) || `Entity not available: ${missing.join(", ")}`;
      return html`<hui-warning>${message}</hui-warning>`;
    }

    const range = this._computeRange();
    if (!range) return nothing;

    // An unavailable entity keeps its row, with the slider disabled and its
    // state spelled out, rather than showing a handle at a value it does not
    // have.
    const unavailable = [this.config.entity, this.config.range_entity].filter(
      (entityId) => !this._isNumeric(entityId),
    );

    const { min, max, step } = range;

    // An inverted pair can only come from outside the card, since the handles
    // cannot be dragged past each other. The slider itself has to be given the
    // values in order, but the readout shows them as the entities actually hold
    // them, flagged, rather than quietly presenting them the other way round.
    const inverted =
      !this._interacting &&
      range.lowerVal > range.upperVal &&
      this.config.warn_inverted !== false;

    const readout = (entityId: string, value: number): string => {
      // An em dash, which is what the stock row shows for an entity with no
      // usable state.
      if (!this._isNumeric(entityId)) return "—";
      const stateObj = this.hass!.states[entityId]!;
      // Alongside an unavailable partner the two are not a range, so each
      // entity shows its own state rather than a sorted pair.
      return this._formatValue(
        entityId,
        unavailable.length ? parseFloat(stateObj.state) : value,
      );
    };

    const lower = readout(
      this.config.entity,
      inverted ? range.lowerVal : this._lowerVal,
    );
    const upper = readout(
      this.config.range_entity,
      inverted ? range.upperVal : this._upperVal,
    );
    const invertedTitle = inverted
      ? `${this.config.entity} (${lower}) is above ` +
        `${this.config.range_entity} (${upper}). The slider shows them in ` +
        `order; dragging it writes them back in order.`
      : "";

    return html`
      <hui-generic-entity-row .hass=${this.hass} .config=${this._buildRowConfig()}>
        <div class="flex">
          <ha-slider
            labeled
            range
            ?collapsed=${this._lowerVal === this._upperVal}
            .disabled=${unavailable.length > 0}
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
            : nothing}
          <span class="state ${inverted ? "inverted-warning" : ""}"
            >${lower}<br />${upper}</span
          >
        </div>
      </hui-generic-entity-row>
    `;
  }

  /**
   * Home Assistant paints no handles on a range slider, so the card supplies
   * them, in whichever shape suits the active theme. The styling goes into
   * ha-slider's own shadow root, which is the only way to reach the handles.
   */
  private _styleRangeSliderThumbs(): void {
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

        const existing = sliderShadow.querySelector<HTMLStyleElement>(
          `#${RANGE_SLIDER_STYLE_ID}`,
        );
        if (existing?.dataset["variant"] === variant) return;
        existing?.remove();

        const style = document.createElement("style");
        style.id = RANGE_SLIDER_STYLE_ID;
        style.dataset["variant"] = variant;
        style.textContent = thumbCss(materialYou);
        sliderShadow.appendChild(style);
      }, 50);
    } catch (error) {
      console.debug("Could not style the range slider thumbs:", error);
    }
  }

  // ── Slider events ───────────────────────────────────────────────────────────

  private _onInput(event: Event): void {
    const slider = event.target as RangeSlider;
    const previousLower = this._lowerVal;
    const previousUpper = this._upperVal;
    let lower = slider.minValue;
    let upper = slider.maxValue;

    // ha-slider pushes the stationary handle along when the dragged one reaches
    // it. Stop the dragged handle at the other instead: if both moved, the one
    // that did not lead the move gets pinned back where it was.
    if (
      this._interacting &&
      lower !== previousLower &&
      upper !== previousUpper
    ) {
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

  private _onChange(event: Event): void {
    this._interacting = false;
    const slider = event.target as RangeSlider;
    const config = this.config!;
    const lower = this.hass?.states[config.entity];
    const upper = this.hass?.states[config.range_entity];
    if (lower && slider.minValue !== parseFloat(lower.state)) {
      this._callService(config.entity, slider.minValue);
    }
    if (upper && slider.maxValue !== parseFloat(upper.state)) {
      this._callService(config.range_entity, slider.maxValue);
    }
  }

  // ── Home Assistant service call ─────────────────────────────────────────────

  private _callService(entityId: string, value: number): void {
    // min/max are merged across both entities so the slider can span the pair,
    // which means a handle can reach a value its own entity would reject.
    const attributes = this.hass?.states[entityId]?.attributes ?? {};
    const min = parseFloat(String(attributes.min));
    const max = parseFloat(String(attributes.max));
    let clamped = value;
    if (Number.isFinite(min)) clamped = Math.max(min, clamped);
    if (Number.isFinite(max)) clamped = Math.min(max, clamped);

    // input_number.set_value and number.set_value take the same arguments.
    void this.hass?.callService(entityId.split(".")[0]!, "set_value", {
      entity_id: entityId,
      value: clamped,
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  static override styles = css`
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
      /* Each value stays on its own line: the readout is already two lines, and
         a theme with a wide font would otherwise wrap the unit onto a third
         that the row height clips away. */
      white-space: nowrap;
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
      /* The stock input_number row uses exactly this: the horizontal margin
         leaves room for the thumb at min and max, so the card's overflow-x does
         not clip it. */
      margin: 1px var(--ha-space-2, 8px);
    }
    /* Override material-you styles for range sliders */
    ha-slider::part(indicator) {
      margin-inline-end: 0 !important;
      box-shadow: none !important;
    }
  `;
}

customElements.define("range-entity-row", RangeEntityRow);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "range-entity-row",
  name: "Range Entity Row",
  description:
    "Two input_number or number entities as a dual-handle range slider row.",
});

console.info(
  `%c RANGE-ENTITY-ROW %c ${VERSION} `,
  "color:#fff;background:#4caf50;font-weight:bold;padding:2px 4px;border-radius:3px 0 0 3px",
  "color:#4caf50;background:#f0f0f0;font-weight:bold;padding:2px 4px;border-radius:0 3px 3px 0",
);
