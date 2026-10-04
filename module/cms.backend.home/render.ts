import { errMsg, html } from "@qino/qino";
import { actions, entities, providers } from "@qino/qino/home";

import { settings } from "./settings.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Action, Entity } from "@qino/qino/home";

const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
    <div cms-part=settings style="display:contents">${settings(node)}</div>
    <div cms-part=list style="display:contents">${list(node)}</div>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const app = node.app, names = providers(app);
  if (!names.length) return html`<p>${await app.t`No home providers are linked.`}</p>`;
  return html.join(await Promise.all(names.map(async (provider) => {
    const [endpoints, commands] = await Promise.allSettled([entities(app, provider), actions(app, provider)]);
    return html.async`<section class=u2-card>
      <div class=-head>${provider}<button type=button data-refresh>${app.t`Refresh`}</button></div>
      ${endpoints.status === "fulfilled" ? renderEntities(app, endpoints.value) : html`<p role=alert>${errMsg(endpoints.reason)}</p>`}
      ${commands.status === "fulfilled"
        ? renderActions(app, provider, commands.value, endpoints.status === "fulfilled" ? endpoints.value : [])
        : html`<p role=alert>${errMsg(commands.reason)}</p>`}
    </section>`;
  })));
}

export function renderEntities(app: App, endpoints: Entity[]): Promise<HtmlString> {
  const t = app.t;
  if (!endpoints.length) return html.async`<p>${t`No entities were found.`}</p>`;
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Entity`}
      <th>${t`State`}
      <th>${t`Availability`}
      <th>${t`Updated`}
    <tbody>${endpoints.map((entity) => html.async`<tr>
      <td>${entity.name}<br><code>${entity.id}</code>
      <td><pre>${text(entity.state)}</pre>
        ${Object.keys(entity.attributes).length ? html.async`<details>
          <summary>${t`Attributes`}</summary><pre>${text(entity.attributes)}</pre>
        </details>` : ""}
      <td>${entity.available ? t`Available` : t`Unavailable`}
      <td>${entity.updated ?? "—"}
    </tr>`)}
    </tbody>
  </table>`;
}

export function renderActions(app: App, provider: string, commands: Action[], endpoints: Entity[]): Promise<HtmlString> {
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
