import { errMsg, html, invoke } from "@qino/qino";

import { chart, points } from "./chart.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Entity } from "@qino/qino/home";

async function plot(node: Node, { vars: period = {} }: { vars?: { start?: string; end?: string } } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const provider = String(node.settings.provider() ?? ""), entity = String(node.settings.entity() ?? "");
  const end = period?.end ?? new Date().toISOString();
  const hours = Number(node.settings.hours() ?? 24);
  const start = period.start ?? new Date((Number.isFinite(Date.parse(end)) ? Date.parse(end) : Date.now()) - hours * 3600_000).toISOString();
  const consumption = Boolean(node.settings.consumption()), maxGap = Number(node.settings.maxGap() ?? 180);
  const form = html.async`<form data-period>
    <label>${t`Start (ISO timestamp with timezone)`}<input name=start value="${start}" required></label>
    <label>${t`End (ISO timestamp with timezone)`}<input name=end value="${end}" required></label>
    <button type=submit>${t`Show`}</button>
  </form>`;
  try {
    if (!provider || !entity) return html.async`<p>${t`Configure a provider and entity in this chart's settings.`}</p>`;
    const samples = await invoke(app.apiTree, "get", `/home.history/provider/${encodeURIComponent(provider)}/entity/${encodeURIComponent(entity)}`, {
      start, end, source: String(node.settings.source() ?? "auto"),
    }) as Entity[];
    const values = points(samples, { consumption, maxGap });
    const label = await (consumption ? t`Counter consumption per observation interval` : t`Measured values`);
    return html.async`<div>
      <h3>${samples.find((sample) => sample.name)?.name ?? entity}</h3>
      ${form}
      ${chart(samples, { start: Date.parse(start), end: Date.parse(end), consumption, maxGap, label }) ?? html.async`<p>${t`No numeric observations in this period.`}</p>`}
      ${consumption ? html.async`<p>${t`Consumption is the counter difference per observation interval. Resets and gaps interrupt the curve.`}</p>` : ""}
      <details><summary>${t`Observations`}</summary>
        <table class=u2-table>
          <thead><tr>
            <th>${t`Time (UTC)`}
            <th>${t`Value`}
            <th>${t`Unit`}
          <tbody>${values.map((point) => html`<tr>
            <td>${new Date(point.time).toISOString()}</td>
            <td>${point.value ?? "—"}</td>
            <td>${point.unit ?? ""}</td>
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
    provider: { type: "string", default: "", description: "Home provider name." },
    entity: { type: "string", default: "", description: "Provider-local entity ID." },
    source: { type: "string", enum: ["auto", "local", "provider"], default: "auto" },
    hours: { type: "number", minimum: 0.01, default: 24, description: "Initial period in hours." },
    consumption: { type: "boolean", default: false, description: "Show differences of cumulative counter readings." },
    maxGap: { type: "number", minimum: 0, default: 180, description: "Maximum connected observation interval in seconds; zero disables this limit." },
  } },
} };
