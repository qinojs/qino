import { html } from "@qino/qino";

import type { Sample } from "@qino/qino/home.history";

/** Significant digits only: bucket means would otherwise print 15 decimals. */
export const format = (value: number, digits = 6): number => Number(value.toPrecision(digits));

/** Positions follow elapsed time, including intervals with no observations. Dots and envelopes are one path each. */
export function chart(samples: Sample[], { start, end, unit = "", discrete = false, label = "Measured values" }: {
  start: number; end: number; unit?: string; discrete?: boolean; label?: string;
}) {
  const values = samples.filter((point) => point.time >= start && point.time < end);
  const numeric = values.filter((point) => point.value !== null);
  if (!numeric.length) return;
  let min = numeric[0].value!, max = min;
  for (const point of numeric) { min = Math.min(min, point.min ?? point.value!); max = Math.max(max, point.max ?? point.value!); }
  if (min === max) { min -= 0.5; max += 0.5; }
  const x = (time: number) => (60 + (time - start) / (end - start) * 700).toFixed(1);
  const y = (value: number) => (220 - (value - min) / (max - min) * 200).toFixed(1);
  let line = "", dots = "", range = "", connected = false;
  for (const point of values) {
    if (point.value === null) { connected = false; continue; }
    const join = connected && !point.gap;
    line += join && discrete ? `H${x(point.time)}V${y(point.value)}` : `${join ? "L" : "M"}${x(point.time)},${y(point.value)}`;
    dots += `M${x(point.time)},${y(point.value)}h0`;
    if (point.min !== undefined && point.max !== undefined && point.min !== point.max)
      range += `M${x(point.time)},${y(point.min)}V${y(point.max)}`;
    connected = true;
  }
  return html`<svg viewBox="0 0 800 230" role=img aria-label="${label}" style="width:100%;height:auto">
    <title>${label}</title>
    <path d="M60,20V220H760" fill=none stroke=currentColor />
    <path d="${range}" stroke=currentColor />
    <path d="${line}" fill=none stroke=currentColor stroke-width=2 />
    <path d="${dots}" stroke=currentColor stroke-width=4 stroke-linecap=round />
    <text x=55 y=25 text-anchor=end fill=currentColor>${format(max, 4)}</text>
    <text x=55 y=220 text-anchor=end fill=currentColor>${format(min, 4)}</text>
    <text x=55 y=125 text-anchor=end fill=currentColor>${unit}</text>
  </svg>`;
}
