/**
 * Card-specific types. The Home Assistant surface itself comes from
 * custom-card-helpers, which the community boilerplate uses and which tracks
 * the frontend far better than a hand-written copy could.
 */
import type { ActionConfig } from "custom-card-helpers";

export interface RangeEntityRowConfig {
  type?: string;
  entity: string;
  range_entity: string;
  name?: string;
  icon?: string;
  /** Flag a pair whose upper entity is below its lower one. Default true. */
  warn_inverted?: boolean;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

/** What hui-generic-entity-row is given, which is a subset of the above. */
export interface GenericRowConfig {
  entity: string;
  name?: string;
  icon?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

/** The bounds and values the pair of entities describes between them. */
export interface Range {
  min: number;
  max: number;
  step: number;
  lowerVal: number;
  upperVal: number;
  unit: string;
}

/** The slider's shadow DOM internals the card reaches into. */
export interface RangeSlider extends HTMLElement {
  minValue: number;
  maxValue: number;
}

declare global {
  interface Window {
    customCards?: {
      type: string;
      name: string;
      description: string;
    }[];
  }
}
