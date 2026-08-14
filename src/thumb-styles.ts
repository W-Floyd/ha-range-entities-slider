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
    /* Range thumbs carry a 1px border the single thumb does not. Insets are
       measured inside it, so the bar sat 5px from one edge and 3px from the
       other — off centre whether or not it was being dragged. */
    border: none;
    /* The stock thumb is a square-cornered rectangle in this colour: it punches
       the gap through the track either side of the handle. Rounding it here
       curves the gap inwards, which reads as the neighbouring segments being
       cut concave. */
    border-radius: 0;
    transition:
      width var(--md-sys-motion-expressive-spatial-default),
      left var(--md-sys-motion-expressive-spatial-default);
  }
  /* Positioned exactly as the utilities position the single thumb's bar: a
     fixed 4px inset inside a 12px thumb, which centres it without a transform.
     Using left: 50% with translateX(-50%) instead put a transform on the bar
     that compounded with the thumb's own when either was scaled, walking the
     bar off centre. */
  :host([range]) #thumb-min::before,
  :host([range]) #thumb-max::before {
    content: '';
    position: absolute;
    height: var(--thumb-actual-height);
    width: 4px;
    top: calc(-0.5 * (var(--thumb-actual-height) - var(--ha-slider-track-size)));
    inset-inline-start: 4px;
    border-radius: var(--md-sys-shape-corner-full);
    background: var(
      --ha-slider-thumb-color,
      var(--ha-slider-indicator-color, var(--md-sys-color-primary))
    );
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
     actually being dragged.

     Keyed on a "held" attribute the card mirrors from those tooltips rather than
     reading them directly with #slider:has(~ #tooltip-thumb-max[open]). The
     :has() form matches and takes precedence in every engine, but Firefox never
     recomputes the thumb's own scale when the tooltip's attribute appears, so
     the handle kept its full width while the track around it moved in. An
     attribute on the host invalidates everywhere. */
  :host([range][held="min"]) #thumb-min,
  :host([range][held="max"]) #thumb-max {
    scale: 0.66667 1;
  }
  /* Scale, as the utilities do, rather than narrowing the width: the bar sits
     at a fixed inset, so a narrower width moves its centre, where a scale keeps
     it. */
  :host([range][held="min"]) #thumb-min::before,
  :host([range][held="max"]) #thumb-max::before {
    scale: 0.75 1;
  }

  /* And the inactive corner shape moves in with it, which is what closes the
     gap around the handle while it is held — the utilities move theirs from
     -18px to -14px. */
  :host([range][held="min"]) #indicator::before {
    inset-inline-start: -14px !important;
  }
  :host([range][held="max"]) #indicator::after {
    inset-inline-end: -14px !important;
  }
  /* Only the end being dragged tightens. Closing both left the still handle
     with a 4px gap against a full-width cut-out, showing as a sliver of track
     beside it. */
  :host([range][held="min"]) #indicator {
    margin-inline-start: 4px !important;
  }
  :host([range][held="max"]) #indicator {
    margin-inline-end: 4px !important;
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

  /* The value popup. The utilities style #tooltip::part(body); a range slider
     raises one popup per handle, so ours went unstyled and fell back to Home
     Assistant's default while the stock row got the theme's. */
  :host([range]) #tooltip-thumb-min::part(body),
  :host([range]) #tooltip-thumb-max::part(body) {
    background-color: var(--md-sys-color-inverse-surface);
    color: var(--md-sys-color-inverse-on-surface);
    border-radius: var(--md-sys-shape-corner-full);
    padding: 12px 16px;
    translate: 0 -6px;
    font-size: var(--md-sys-typescale-label-large-size);
    font-weight: var(--md-sys-typescale-label-large-weight);
    line-height: var(--md-sys-typescale-label-large-line-height);
    letter-spacing: var(--md-sys-typescale-label-large-tracking);
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
