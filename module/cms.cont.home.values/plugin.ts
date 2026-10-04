import { errMsg, html, invoke } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Entity, Provider } from "@qino/qino/home";

async function render(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const provider = Number(node.settings.provider() ?? 0), entity = String(node.settings.entity() ?? "");
  try {
    const rows = await app.api.home.providers.get() as Provider[];
    const selected = rows.filter((row) => row.enabled && (!provider || row.id === provider));
    if (!selected.length) return html.async`<div><p>${t`No home providers are linked.`}</p></div>`;
    const results = await Promise.all(selected.map(async (row) => {
      try {
        const values = await invoke(app.apiTree, "get", "/home/entities", { provider: row.id }) as Entity[];
        const selected = entity ? values.filter((value) => value.id === entity) : values;
        return html.async`<section>
          <h3>${row.name}</h3>
          ${selected.length ? html.async`<table class=u2-table>
            <thead><tr>
              <th>${t`Entity`}
              <th>${t`State`}
              <th>${t`Availability`}
              <th>${t`Updated`}
            <tbody>${selected.map((value) => html.async`<tr>
              <td>${value.name}<br><code>${value.id}</code>
              <td><pre>${typeof value.state === "string" ? value.state : JSON.stringify(value.state, null, 2)}</pre>
              <td>${value.available ? t`Available` : t`Unavailable`}
              <td>${value.updated ?? "—"}
            </tr>`)}</tbody>
          </table>` : html.async`<p>${t`No entities were found.`}</p>`}
        </section>`;
      } catch (error) {
        return html`<section><h3>${row.name}</h3><p role=alert>${errMsg(error)}</p></section>`;
      }
    }));
    return html`<div>${results}</div>`;
  } catch (error) {
    return html`<div><p role=alert>${errMsg(error)}</p></div>`;
  }
}

export const cms = {
  node: {
    render,
    settingsSchema: {
      properties: {
        provider: { type: "integer", minimum: 0, default: 0, description: "Provider ID; zero includes every enabled provider." },
        entity: { type: "string", default: "", description: "Provider-local entity ID; empty includes every entity." },
      },
    },
  },
};
