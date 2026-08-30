import React from 'react';
import { GaugeChart, type GaugeChartProps } from '../components/visualization/index.js';

export type GaugeProps = GaugeChartProps;

/**
 * The system `GaugeChart`, corrected so the arc reports the value honestly.
 *
 * Two defects in the mirror, neither of which it exposes a prop for:
 *
 * 1. **Leaking remainder at 0.** The gauge clips its SVG to `size / 2 + 14`,
 * which is 14px TALLER than the semicircle it means to show. The arc for
 * the unfilled remainder lives just below the diameter, so those 14px let
 * it show through as two coloured stubs at the left and right ends. At any
 * non-zero value the leak sits next to the real arc and reads as part of
 * it; at 0 it is the only thing drawn, and a line that produced nothing
 * appears to have produced something.
 * 2. **Round arc caps.** `stroke-linecap: round` adds half a stroke width of
 * arc at each end, on the live board's stroke, arc the reading has not
 * earned.
 *
 * `fv/mirror-fixes.css` fixes both: flat caps always, and the progress arc
 * hidden outright at 0. The wrapper supplies the class hooks, because
 * `GaugeChart` renders none of its own. Nothing else about it changes.
 */
export const Gauge: React.FC<GaugeProps> = (props) => (
  <div className={`fv-gauge${(props.value ?? 0) <= 0 ? ' fv-gauge--empty' : ''}`}>
    <GaugeChart {...props} />
  </div>
);
