/**
 * Home Assistant does not paint handles on a range slider at all — with no
 * styling of our own the handles show only as gaps in the track. What they
 * should look like depends on the active theme, so there are two variants:
 *
 * - material-you: vertical bars, matching that theme's own slider handles.
 * - everything else: a round knob, matching the stock input_number row.
 *
 * This CSS is injected into ha-slider's shadow root, which is the only way to
 * reach #thumb-min and #thumb-max. Those ids are private to the component and
 * can be renamed upstream at any time, which is what the render test watches.
 */

export const RANGE_SLIDER_STYLE_ID = "range-slider-fix";

const MATERIAL_YOU = `
  /* Apply same thumb styling to range slider thumbs */
  :host([range]) #thumb-min,
  :host([range]) #thumb-max {
    overflow: visible;
    background: var(--ha-slider-thumb-negative-color);
    /* The stock thumb is a square-cornered rectangle in this colour: it punches
       the gap through the track either side of the handle. Rounding it here
       curves the gap inwards, which reads as the neighbouring segments being
       cut concave. */
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

  /* material-you-utilities styles a single #thumb and never the range pair, so
     its treatment of the ends is mirrored here. It gives the active track a 2px
     corner and a 6px gap where it meets the thumb, plus an "inactive track inner
     corner shape" (#indicator::after) that rounds the inactive side of the same
     gap. In range mode both ends of the indicator meet a thumb, so each end
     needs all three. */
  :host([range]) #indicator {
    border-radius: 2px !important;
    margin-inline: 6px !important;
    box-shadow:
      4px 0 0 var(--ha-slider-thumb-negative-color),
      -4px 0 0 var(--ha-slider-thumb-negative-color) !important;
  }

  /* Dragging: the utilities narrow the handle and tighten the gap while a value
     tooltip is open, keyed on #tooltip — which a range slider does not have,
     since its tooltips are per handle. Same treatment, keyed on the handle
     actually being dragged. */
  :host([range]) #slider:has(~ #tooltip-thumb-min[open]) #thumb-min,
  :host([range]) #slider:has(~ #tooltip-thumb-max[open]) #thumb-max {
    scale: 0.66667 1;
  }
  :host([range]) #slider:has(~ #tooltip-thumb-min[open]) #thumb-min::before,
  :host([range]) #slider:has(~ #tooltip-thumb-max[open]) #thumb-max::before {
    scale: 0.75 1;
  }
  :host([range]) #slider:has(~ #tooltip-thumb-min[open]) #indicator,
  :host([range]) #slider:has(~ #tooltip-thumb-max[open]) #indicator {
    margin-inline: 4px !important;
  }

  /* With both handles on the same value the active track has no width, so the
     gap and its corner shapes have nothing to sit against and paint as stray
     slivers beside the handle. */
  :host([range][collapsed]) #indicator {
    margin-inline: 0 !important;
  }
  :host([range][collapsed]) #indicator::before,
  :host([range][collapsed]) #indicator::after {
    display: none !important;
  }

  /* The utilities' own ::after shapes the right-hand inner corner; this is the
     same shape mirrored onto the left. */
  :host([range]) #indicator::before {
    content: '';
    position: absolute;
    inset-inline-start: -18px;
    height: var(--ha-slider-track-size);
    width: 6px;
    border-radius: 2px;
    box-shadow: 4px 0 0 3px var(--ha-slider-thumb-negative-color);
    transition: inset-inline-start var(--md-sys-motion-expressive-spatial-default);
  }
`;

/* Match the knob on a stock input_number slider row. The thumb element is
   already sized by Home Assistant exactly as the stock knob is, so painting it
   directly — rather than drawing a shape over it — keeps the two in step
   through upstream sizing changes and the slider's size variants.
   --slider-color is what the stock knob and the indicator use. */
const DEFAULT = `
  :host([range]) #thumb-min,
  :host([range]) #thumb-max {
    background: var(--slider-color, var(--primary-color, #03a9f4));
    border-radius: 50%;
    /* Range thumbs carry a 1px white border that the stock knob does not. With
       border-box sizing it eats into the same 16px, leaving a white ring around
       a smaller dot. */
    border: none;
  }
`;

export const thumbCss = (materialYou: boolean): string =>
  materialYou ? MATERIAL_YOU : DEFAULT;
