import { html } from "@qino/qino";

import type { Sample } from "@qino/qino/home.history";

/** Positions follow elapsed time, including intervals with no observations. */
export function chart(samples: Sample[], { start, end, unit = "", discrete = false, label = "Measured values" }: { start: number; end: number; unit?: string; discrete?: boolean; label?: string }) {
  const values = samples.filter((point) => point.time >= start && point.time < end);
  const numeric = values.filter((point) => point.value !== null);
  if (!numeric.length) return;
  let min = numeric[0].value!, max = min;
  for (const point of numeric) { min = Math.min(min, point.min ?? point.value!); max = Math.max(max, point.max ?? point.value!); }
  if (min === max) { min -= 0.5; max += 0.5; }
  const x = (time: number) => 60 + (time - start) / (end - start) * 700;
  const y = (value: number) => 220 - (value - min) / (max - min) * 200;
  let path = "", connected = false;
  for (const point of values) {
    if (point.value === null) { connected = false; continue; }
    path += connected && !point.gap && discrete ? `H${x(point.time).toFixed(2)} V${y(point.value).toFixed(2)} `
      : `${connected && !point.gap ? "L" : "M"}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)} `;
    connected = true;
  }
  return html`<svg viewBox="0 0 800 280" role=img aria-label="${label}" style="width:100%;height:auto">
    <title>${label}</title>
    <path d="M60,20 V220 H760" fill=none stroke=currentColor />
    <path d="${path}" fill=none stroke=currentColor stroke-width=2 />
    ${numeric.map((point) => html`${point.min === undefined || point.max === undefined ? "" : html`<path d="M${x(point.time).toFixed(2)},${y(point.min).toFixed(2)} V${y(point.max).toFixed(2)}" stroke=currentColor />`}<circle cx="${x(point.time).toFixed(2)}" cy="${y(point.value!).toFixed(2)}" r=2 fill=currentColor><title>${new Date(point.time).toISOString()}: ${point.value} ${unit}</title></circle>`)}
    <text x=0 y=25 fill=currentColor>${max}</text><text x=0 y=220 fill=currentColor>${min}</text>
    <text x=60 y=250 fill=currentColor>${new Date(start).toISOString()}</text>
    <text x=760 y=270 text-anchor=end fill=currentColor>${new Date(end).toISOString()}</text>
  </svg>`;
}
