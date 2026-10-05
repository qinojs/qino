import { errMsg, html } from "@qino/qino";
import { history } from "@qino/qino/home.history";

import { chart, format } from "./chart.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Source } from "@qino/qino/home.history";

const time = (at: number, precision = "minute") => {
  const iso = new Date(at).toISOString();
  return html`<u2-time datetime="${iso}" type=date ${html.raw(precision)}>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
};

/** Placing the chart publishes its datapoint: page access decides who sees it. */
async function plot(node: Node, { vars: period = {} }: { vars?: { start?: string; end?: string } } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const datapoint = Number(node.settings.datapoint() ?? 0);
  const end = period.end ?? new Date().toISOString();
  const until = Number.isFinite(Date.parse(end)) ? Date.parse(end) : Date.now();
  const start = period.start ?? new Date(until - Number(node.settings.hours() ?? 24) * 3600_000).toISOString();
  const consumption = Boolean(node.settings.consumption()), maxGap = Number(node.settings.maxGap() ?? 0);
  const span = (seconds: number, label: Promise<string>) => html.async`<button type=button data-span=${seconds}>${label}</button>`;
  // The browser converts between ISO and its local time; see pub/main.js.
  const form = html.async`<form data-period data-start="${start}" data-end="${end}">
    ${span(3600, t`Hour`)}${span(86400, t`Day`)}${span(604800, t`Week`)}${span(2592000, t`Month`)}${span(31536000, t`Year`)}
    <button type=button data-shift=-1>‹ ${t`Earlier`}</button>
    <button type=button data-shift=1>${t`Later`} ›</button>
    <label>${t`From`}<input name=start type=datetime-local required></label>
    <label>${t`To`}<input name=end type=datetime-local required></label>
    <button type=submit>${t`Show`}</button>
  </form>`;
  try {
    if (!datapoint) return html.async`<p>${t`Configure a datapoint in this chart's settings.`}</p>`;
    const { samples, datapoint: point } = await history(app, datapoint, {
      start, end, source: String(node.settings.source() ?? "auto") as Source, width: 700, consumption,
      ...(maxGap ? { maxGap } : {}),
    });
    const label = await (consumption ? t`Counter consumption per chart interval` : t`Measured values`);
    const discrete = point.type === "state";
    return html.async`<div>
      <h3>${point.name}</h3>
      ${form}
      ${chart(samples, { start: Date.parse(start), end: Date.parse(end), unit: point.unit, discrete, label })
        ?? html.async`<p>${t`No numeric observations in this period.`}</p>`}
      <p>${time(Date.parse(start))} – ${time(Date.parse(end))}</p>
      ${consumption ? html.async`<p>${t`Consumption sums valid counter differences per chart interval. Incomplete intervals are marked; resets are never counted as consumption.`}</p>` : ""}
      <details><summary>${t`Observations`}</summary>
        <table class=u2-table>
          <thead><tr>
            <th>${t`Time`}
            <th>${t`Value`} (${point.unit})
          <tbody>${samples.map((sample) => html`<tr>
            <td>${time(sample.time, "second")}
            <td>${sample.value === null ? "—" : format(sample.value)}${sample.gap ? " *" : ""}
          </tr>`)}</tbody>
        </table>
      </details>
    </div>`;
  } catch (error) { return html.async`<div>${form}<p role=alert>${errMsg(error)}</p></div>`; }
}

export const cms = { node: {
  render: (node: Node) => html.async`<div><div cms-part=plot>${plot(node)}</div></div>`,
  parts: { plot },
  js: ["pub/main.js"],
  settingsSchema: { properties: {
    datapoint: { type: "integer", minimum: 0, default: 0, description: "Numeric home datapoint ID." },
    source: { type: "string", enum: ["auto", "local", "provider"], default: "auto" },
    hours: { type: "number", minimum: 0.01, default: 24, description: "Initial period in hours." },
    consumption: { type: "boolean", default: false, description: "Show differences of cumulative counter readings." },
    maxGap: {
      type: "number", minimum: 0, default: 0,
      description: "Maximum connected observation interval in seconds; zero uses the datapoint reporting interval.",
    },
  } },
} };
