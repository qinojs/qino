import { errMsg, html } from "@qino/qino";
import { actions, entities, providers } from "@qino/qino/home";
import * as u2 from "@qino/qino/u2";

import { settings } from "./settings.ts";
import { measurements } from "./datapoints.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Action, Entity } from "@qino/qino/home";

const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
const typeOf = ({ state }: Entity) =>
  typeof state === "boolean" || typeof state === "string" && !Number.isFinite(Number(state)) ? "state" : "number";

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
    <div cms-part=settings style="display:contents">${settings(node)}</div>
    <div cms-part=list style="display:contents">${list(node)}</div>
    <div cms-part=measurements style="display:contents">${measurements(node)}</div>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const app = node.app, rows = await providers(app);
  if (!rows.length) return html.async`<p>${app.t`No providers are configured.`}</p>`;
  return html.join(await Promise.all(rows.map(async (row) => {
    const [endpoints, commands] = await Promise.allSettled([entities(app, row.id), actions(app, row.id)]);
    return html.async`<section class=u2-card>
      <div class=-head>${row.name} (#${row.id})<button type=button data-refresh>${app.t`Refresh`}</button></div>
      ${endpoints.status === "fulfilled"
        ? renderEntities(app, endpoints.value, row.id)
        : html`<p role=alert>${errMsg(endpoints.reason)}</p>`}
      ${commands.status === "fulfilled"
        ? renderActions(app, row.id, commands.value, endpoints.status === "fulfilled" ? endpoints.value : [])
        : html`<p role=alert>${errMsg(commands.reason)}</p>`}
    </section>`;
  })));
}

export function renderEntities(app: App, endpoints: Entity[], provider?: number): Promise<HtmlString> {
  const t = app.t;
  if (!endpoints.length) return html.async`<p>${t`No entities were found.`}</p>`;
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Entity`}
      <th>${t`State`}
      <th>${t`Availability`}
      <th>${t`Updated`}
      ${provider === undefined ? "" : html.async`<th>${t`Datapoint`}</th>`}
    <tbody>${endpoints.map((entity) => html.async`<tr>
      <td>${entity.name}<br><code>${entity.id}</code>
      <td><pre>${text(entity.state)}</pre>
        ${Object.keys(entity.attributes).length ? html.async`<details>
          <summary>${t`Attributes`}</summary><pre>${text(entity.attributes)}</pre>
        </details>` : ""}
      <td>${entity.available ? t`Available` : t`Unavailable`}
      <td>${u2.el.time(entity.updated)}
      ${provider === undefined ? "" : html.async`<td><button type=button data-add-point="${JSON.stringify({
        provider, entity: entity.id, name: entity.name, unit: entity.unit ?? "", type: typeOf(entity),
      })}">${t`Add datapoint`}</button></td>`}
    </tr>`)}
    </tbody>
  </table>`;
}

export function renderActions(app: App, provider: number, commands: Action[], endpoints: Entity[]): Promise<HtmlString> {
  const t = app.t;
  if (!commands.length) return html.async`<p>${t`No actions were found.`}</p>`;
  return html.async`<form data-home-action data-provider="${provider}">
    <label>${t`Action`}
      <select name=action required>
        <option value="">${t`Select an action`}</option>
        ${commands.map((action) => html`<option value="${action.id}" title="${action.description ?? ""}"
          data-fields="${JSON.stringify(action.fields ?? {})}">${action.name} (${action.id})</option>`)}
      </select>
    </label>
    <details><summary>${t`Action fields`}</summary><pre data-action-fields>{}</pre></details>
    <label>${t`Target entities`}
      <select name=entities multiple size=6>
        ${endpoints.map((entity) => html`<option value="${entity.id}">${entity.name} (${entity.id})</option>`)}
      </select>
    </label>
    <p>${t`Leave targets empty only for an action that does not need explicit entities.`}</p>
    <label>${t`Action data (JSON object)`}<textarea name=data rows=6>{}</textarea></label>
    <button type=submit>${t`Execute action`}</button>
  </form>`;
}
