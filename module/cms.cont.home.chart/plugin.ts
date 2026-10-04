import { errMsg, html, invoke } from "@qino/qino";

import { chart } from "./chart.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Datapoint } from "@qino/qino/home";
import type { Sample } from "@qino/qino/home.history";

async function plot(node: Node, { vars: period = {} }: { vars?: { start?: string; end?: string } } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const datapoint = Number(node.settings.datapoint() ?? 0);
  const end = period?.end ?? new Date().toISOString();
  const hours = Number(node.settings.hours() ?? 24);
  const start = period.start ?? new Date((Number.isFinite(Date.parse(end)) ? Date.parse(end) : Date.now()) - hours * 3600_000).toISOString();
  const consumption = Boolean(node.settings.consumption()), maxGap = Number(node.settings.maxGap() ?? 0);
  const form = html.async`<form data-period>
    <label>${t`Start (ISO timestamp with timezone)`}<input name=start value="${start}" required></label>
    <label>${t`End (ISO timestamp with timezone)`}<input name=end value="${end}" required></label>
    <button type=submit>${t`Show`}</button>
  </form>`;
  try {
    if (!datapoint) return html.async`<p>${t`Configure a datapoint in this chart's settings.`}</p>`;
    const result = await invoke(app.apiTree, "get", `/home.history/datapoint/${datapoint}`, {
      start, end, source: String(node.settings.source() ?? "auto"), width: 700, consumption,
      ...(maxGap ? { maxGap } : {}),
    }) as { datapoint: Datapoint; samples: Sample[] };
    const { samples, datapoint: point } = result;
    const label = await (consumption ? t`Counter consumption per chart interval` : t`Measured values`);
    return html.async`<div>
      <h3>${point.name}</h3>
      ${form}
      ${chart(samples, { start: Date.parse(start), end: Date.parse(end), unit: point.unit, discrete: point.type === "state", label }) ?? html.async`<p>${t`No numeric observations in this period.`}</p>`}
      ${consumption ? html.async`<p>${t`Consumption sums valid counter differences per chart interval. Incomplete intervals are marked; resets are never counted as consumption.`}</p>` : ""}
      <details><summary>${t`Observations`}</summary>
        <table class=u2-table>
          <thead><tr>
            <th>${t`Time (UTC)`}
            <th>${t`Value`}
            <th>${t`Unit`}
          <tbody>${samples.map((sample) => html`<tr>
            <td>${new Date(sample.time).toISOString()}</td>
            <td>${sample.value ?? "—"}${sample.gap ? " *" : ""}</td>
            <td>${point.unit}</td>
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
    maxGap: { type: "number", minimum: 0, default: 0, description: "Maximum connected observation interval in seconds; zero uses the datapoint reporting interval." },
  } },
} };
