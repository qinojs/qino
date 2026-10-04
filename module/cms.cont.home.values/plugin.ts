import { errMsg, html, invoke } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Entity } from "@qino/qino/home";

async function render(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const provider = String(node.settings.provider() ?? ""), entity = String(node.settings.entity() ?? "");
  try {
    const names = provider ? [provider] : await app.api.home.providers.get() as string[];
    if (!names.length) return html.async`<div><p>${t`No home providers are linked.`}</p></div>`;
    const results = await Promise.all(names.map(async (name) => {
      try {
        const values = await invoke(app.apiTree, "get", "/home/entities", { provider: name }) as Entity[];
        const selected = entity ? values.filter((value) => value.id === entity) : values;
        return html.async`<section>
          <h3>${name}</h3>
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
        return html`<section><h3>${name}</h3><p role=alert>${errMsg(error)}</p></section>`;
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
        provider: { type: "string", default: "", description: "Provider name; empty includes every linked provider." },
        entity: { type: "string", default: "", description: "Provider-local entity ID; empty includes every entity." },
      },
    },
  },
};
