import { html } from "@qino/qino";

import type { Entity } from "@qino/qino/home";

/** Numeric states only; unavailable values and counter resets interrupt the curve. */
export function points(samples: Entity[], { consumption = false, maxGap = 0 }: { consumption?: boolean; maxGap?: number } = {}) {
  let previous: { time: number; value: number | null; unit?: string } | undefined;
  return [...samples].sort((a, b) => Date.parse(a.updated ?? "") - Date.parse(b.updated ?? "")).map((sample) => {
    const time = Date.parse(sample.updated ?? ""), state = sample.state;
    const numeric = typeof state === "number" || typeof state === "string" && state.trim() !== "";
    const value = sample.available && numeric && Number.isFinite(Number(state)) ? Number(state) : null;
    const current = { time, value, unit: sample.unit };
    const continuous = previous && previous.value !== null && value !== null && time > previous.time &&
      previous.unit === current.unit && (!maxGap || time - previous.time <= maxGap * 1000);
    const result = { ...current, value: consumption ? continuous && value! >= previous!.value! ? value! - previous!.value! : null : value, break: !continuous };
    previous = current;
    return result;
  }).filter((point) => Number.isFinite(point.time));
}

/** Positions follow elapsed time, including intervals with no observations. */
export function chart(samples: Entity[], { start, end, consumption = false, maxGap = 0, label = consumption ? "Counter consumption per observation interval" : "Measured values" }: { start: number; end: number; consumption?: boolean; maxGap?: number; label?: string }) {
  const values = points(samples, { consumption, maxGap }).filter((point) => point.time >= start && point.time < end);
  const numeric = values.filter((point) => point.value !== null);
  if (!numeric.length) return;
  let min = numeric[0].value!, max = min;
  for (const point of numeric) { min = Math.min(min, point.value!); max = Math.max(max, point.value!); }
  if (min === max) { min -= 0.5; max += 0.5; }
  const x = (time: number) => 60 + (time - start) / (end - start) * 700;
  const y = (value: number) => 220 - (value - min) / (max - min) * 200;
  let path = "", connected = false;
  for (const point of values) {
    if (point.value === null) { connected = false; continue; }
    path += `${connected && !point.break ? "L" : "M"}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)} `;
    connected = true;
  }
  return html`<svg viewBox="0 0 800 280" role=img aria-label="${label}" style="width:100%;height:auto">
    <title>${label}</title>
    <path d="M60,20 V220 H760" fill=none stroke=currentColor />
    <path d="${path}" fill=none stroke=currentColor stroke-width=2 />
    ${numeric.map((point) => html`<circle cx="${x(point.time).toFixed(2)}" cy="${y(point.value!).toFixed(2)}" r=2 fill=currentColor><title>${new Date(point.time).toISOString()}: ${point.value} ${point.unit ?? ""}</title></circle>`)}
    <text x=0 y=25 fill=currentColor>${max}</text><text x=0 y=220 fill=currentColor>${min}</text>
    <text x=60 y=250 fill=currentColor>${new Date(start).toISOString()}</text>
    <text x=760 y=270 text-anchor=end fill=currentColor>${new Date(end).toISOString()}</text>
  </svg>`;
}
