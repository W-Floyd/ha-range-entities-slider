/**
 * The visual editor Home Assistant opens for this row.
 *
 * Rows get GUI editors the same way cards do: hui-row-element-editor resolves
 * the row's class and calls its static getConfigElement().
 *
 * Built on ha-form with a selector schema rather than hand-placed inputs, so
 * the entity pickers, icon picker and layout are Home Assistant's own and
 * follow it as it changes.
 */
import { fireEvent } from "custom-card-helpers";
import type { HomeAssistant } from "custom-card-helpers";
import { LitElement, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { RangeEntityRowConfig } from "./types.js";

/** The domains the row can write to. */
const DOMAINS = ["input_number", "number"];

interface SchemaEntry {
  name: string;
  required?: boolean;
  /** Only "expandable" is used, for the collapsible action groups. */
  type?: string;
  /** Set on an expandable group so its keys stay at the top level. */
  flatten?: boolean;
  title?: string;
  selector?: Record<string, unknown>;
  schema?: SchemaEntry[];
}

/** The action trio Home Assistant offers on a card, for one target. */
const actionSchema = (prefix: string): SchemaEntry[] =>
  (["tap_action", "hold_action", "double_tap_action"] as const).map((name) => ({
    name: `${prefix}${name}`,
    selector: { ui_action: { default_action: "more-info" } },
  }));

const SCHEMA: SchemaEntry[] = [
  {
    name: "entity",
    required: true,
    selector: { entity: { domain: DOMAINS } },
  },
  {
    name: "range_entity",
    required: true,
    selector: { entity: { domain: DOMAINS } },
  },
  { name: "name", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  { name: "warn_inverted", selector: { boolean: {} } },
  // The three targets a gesture can land on are separate: the row's name and
  // icon, which hui-generic-entity-row handles, and each of the two values,
  // which stand for their own entity.
  {
    name: "row_interactions",
    type: "expandable",
    flatten: true,
    title: "Name and icon actions",
    schema: actionSchema(""),
  },
  {
    name: "value_interactions",
    type: "expandable",
    flatten: true,
    title: "Lower value actions",
    schema: actionSchema("value_"),
  },
  {
    name: "range_value_interactions",
    type: "expandable",
    flatten: true,
    title: "Upper value actions",
    schema: actionSchema("range_value_"),
  },
];

const LABELS: Record<string, string> = {
  entity: "Lower handle entity",
  range_entity: "Upper handle entity",
  name: "Name",
  icon: "Icon",
  warn_inverted: "Flag an upper value below the lower one",
  row_interactions: "Name and icon actions",
  value_interactions: "Lower value actions",
  range_value_interactions: "Upper value actions",
  tap_action: "Tap behavior",
  hold_action: "Hold behavior",
  double_tap_action: "Double tap behavior",
  value_tap_action: "Tap behavior",
  value_hold_action: "Hold behavior",
  value_double_tap_action: "Double tap behavior",
  range_value_tap_action: "Tap behavior",
  range_value_hold_action: "Hold behavior",
  range_value_double_tap_action: "Double tap behavior",
};

export class RangeEntityRowEditor extends LitElement {
  static override get properties() {
    return { hass: {}, _config: { state: true } };
  }

  hass?: HomeAssistant;

  private _config?: RangeEntityRowConfig;

  setConfig(config: RangeEntityRowConfig): void {
    // warn_inverted defaults to on, so it has to be present for the checkbox to
    // show the state the row actually behaves in.
    this._config = { ...config, warn_inverted: config.warn_inverted !== false };
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${SCHEMA}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _computeLabel = (schema: SchemaEntry): string =>
    LABELS[schema.name] ?? schema.name;

  private _valueChanged(event: CustomEvent): void {
    const config = { ...event.detail.value } as RangeEntityRowConfig;
    // Leave the default out of the saved config rather than writing a key that
    // says what would have happened anyway.
    if (config.warn_inverted !== false) delete config.warn_inverted;
    fireEvent(this, "config-changed", { config });
  }
}

customElements.define("range-entity-row-editor", RangeEntityRowEditor);
