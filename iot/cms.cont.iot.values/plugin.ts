import { errMsg, html } from "@qino/qino";
import { entities, providers } from "@qino/qino/home";

import type { Node } from "@qino/qino/cms";
import type { Entity, Provider } from "@qino/qino/home";

/** Placing the block publishes its values: page access decides who sees them. */
async function render(node: Node) {
  const app = node.app, t = app.t;
  const provider = Number(node.settings.provider() ?? 0), entity = String(node.settings.entity() ?? "");
  const table = (values: Entity[]) => html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Entity`}
      <th>${t`State`}
      <th>${t`Availability`}
      <th>${t`Updated`}
    <tbody>${values.map((value) => html.async`<tr>
      <td>${value.name}<br><code>${value.id}</code>
      <td><pre>${typeof value.state === "string" ? value.state : JSON.stringify(value.state, null, 2)}</pre>
      <td>${value.available ? t`Available` : t`Unavailable`}
      <td>${value.updated ?? "—"}
    </tr>`)}</tbody>
  </table>`;
  const section = async (row: Provider) => {
    try {
      const values = (await entities(app, row.id)).filter((value) => !entity || value.id === entity);
      return html.async`<section>
        <h3>${row.name}</h3>
        ${values.length ? table(values) : html.async`<p>${t`No entities were found.`}</p>`}
      </section>`;
    } catch (error) {
      return html`<section><h3>${row.name}</h3><p role=alert>${errMsg(error)}</p></section>`;
    }
  };
  try {
    const rows = (await providers(app)).filter((row) => row.enabled && (!provider || row.id === provider));
    if (!rows.length) return html.async`<div><p>${t`No home providers are linked.`}</p></div>`;
    return html.async`<div>${rows.map(section)}</div>`;
  } catch (error) {
    return html`<div><p role=alert>${errMsg(error)}</p></div>`;
  }
}

export const cms = {
  node: {
    render,
    settingsSchema: {
      properties: {
        provider: {
          type: "integer", minimum: 0, default: 0, description: "Provider ID; zero includes every enabled provider.",
        },
        entity: { type: "string", default: "", description: "Provider-local entity ID; empty includes every entity." },
      },
    },
  },
};
