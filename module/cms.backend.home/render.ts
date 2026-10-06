import { errMsg, html } from "@qino/qino";
import { actions, commands, entities, providers } from "@qino/qino/home";
import * as u2 from "@qino/qino/u2";

import { settings } from "./settings.ts";
import { datapointForm, measurements } from "./datapoints.ts";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Action, Command, Entity } from "@qino/qino/home";

const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
const typeOf = ({ state }: Entity) =>
  typeof state === "boolean" || typeof state === "string" && !Number.isFinite(Number(state)) ? "state" : "number";

/** The page's views, each a cms-part; `?show=` picks one. */
export const views = { live, datapoints: measurements, actions: control, providers: settings };

export function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t, show = String((ctx.req.query as Record<string, unknown>).show ?? "");
  const current = Object.hasOwn(views, show) ? show as keyof typeof views : "live";
  const labels = { live: t`Live`, datapoints: t`Datapoints`, actions: t`Actions`, providers: t`Providers` };
  const link = (name: string) => {
    const url = ctx.req.url.toURL();
    url.searchParams.set("show", name);
    return url.pathname + url.search;
  };
  return html.async`<section class=u2-card>
    <div class=-head>
      ${Object.entries(labels).map(([name, label]) => html.async`<a href="${link(name)}"
        ${name === current ? html.raw("aria-current=page") : ""}>${label}</a>`)}
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <div cms-part=${current}>${views[current](node)}</div>
  </section>`;
}

/** A button that opens `content` in a dialog (pub/main.js). */
export function dialog(label: unknown, title: unknown, content: unknown): Promise<HtmlString> {
  return html.async`<button type=button data-dialog>${label}</button><template><h3>${title}</h3>${content}</template>`;
}

/** A row of a dialog form's field table (`u2-table -Fields -Flex`); `control` carries the `id`. */
export function field(id: string, label: unknown, control: unknown): Promise<HtmlString> {
  return html.async`<tr>
    <th><label for="${id}">${label}</label></th>
    <td>${control}</td>
  </tr>`;
}

const enabled = async (app: App) => (await providers(app)).filter((row) => row.enabled);

/** Live observations per enabled provider; each entity can become a datapoint. */
export async function live(node: Node): Promise<HtmlString> {
  const app = node.app, rows = await enabled(app);
  if (!rows.length) return html.async`<p>${app.t`No provider is enabled.`}</p>`;
  return html.async`<template data-new-point>
      <h3>${app.t`Add datapoint`}</h3>${datapointForm(app, { record: true }, rows)}
    </template>
    ${html.join(await Promise.all(rows.map(async (row) => html.async`<h3>${row.name}</h3>
      ${await entities(app, row.id).then(
        (list) => renderEntities(app, list, row.id),
        (error) => html`<p role=alert>${errMsg(error)}</p>`,
      )}`)))}`;
}

/** Per enabled provider: its stored commands and a form to call an action or store it as a command. */
export async function control(node: Node): Promise<HtmlString> {
  const app = node.app, rows = await enabled(app), stored = await commands(app);
  if (!rows.length) return html.async`<p>${app.t`No provider is enabled.`}</p>`;
  return html.join(await Promise.all(rows.map(async (row) => {
    const [endpoints, list] = await Promise.allSettled([entities(app, row.id), actions(app, row.id)]);
    const own = stored.filter((command) => command.provider === row.id);
    const known = list.status === "fulfilled" ? list.value : [];
    return html.async`<h3>${row.name}</h3>
      ${own.length ? renderCommands(app, own, known) : ""}
      ${list.status === "fulfilled"
        ? renderActions(app, row.id, list.value, endpoints.status === "fulfilled" ? endpoints.value : [])
        : html`<p role=alert>${errMsg(list.reason)}</p>`}`;
  })));
}

/** The schema at a dotted path of an action's data, if the action describes it. */
const schemaAt = (input: Record<string, unknown> | undefined, path: string) => path.split(".").reduce<
  Record<string, unknown> | undefined>((schema, key) => (schema?.properties as Record<string, never>)?.[key], input);

/** A command with a parameter runs with a value: a number field when its schema says so, otherwise free input. */
function runner(app: App, command: Command, actions: Action[]): Promise<HtmlString> {
  const t = app.t;
  if (!command.parameter) return html.async`<button type=button data-run="${command.id}">${t`Run`}</button>`;
  const schema = schemaAt(actions.find((action) => action.id === command.action)?.input, command.parameter);
  const number = schema?.type === "number" || schema?.type === "integer";
  return html.async`<form data-run-command data-id="${command.id}" class=u2-flex>
    <input name=value required aria-label="${command.parameter}" placeholder="${command.parameter}"
      data-type="${number ? "number" : "auto"}" ${number ? html`type=number step=any min="${schema.minimum ?? ""}"
      max="${schema.maximum ?? ""}"` : ""}>
    <button type=submit>${t`Run`}</button>
  </form>`;
}

export function renderCommands(app: App, list: Command[], actions: Action[] = []): Promise<HtmlString> {
  const t = app.t;
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Command`}
      <th>${t`Action`}
      <th>${t`Targets`}
      <th>${t`Run`}
      <th>
    <tbody>${list.map((command) => html.async`<tr>
      <td>${command.name}
      <td><code>${command.action}</code>
      <td>${command.targets.join(", ")}
      <td>${runner(app, command, actions)}
      <td>
        <button type=button data-edit="${JSON.stringify(command)}">${t`Edit`}</button>
        <button type=button data-remove-command="${command.id}">${t`Delete`}</button>
    </tr>`)}
    </tbody>
  </table>`;
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
      <th>
    <tbody>${endpoints.map((entity) => html.async`<tr>
      <td>${entity.name}<br><code>${entity.id}</code>
      <td>${text(entity.state)}
      <td>${entity.available ? t`Available` : t`Unavailable`}
      <td>${u2.el.time(entity.updated)}
      <td>
        ${Object.keys(entity.attributes).length
          ? dialog(t`Attributes`, entity.name, html`<pre>${text(entity.attributes)}</pre>`) : ""}
        ${provider === undefined ? "" : html.async`<button type=button data-add-point="${JSON.stringify({
          provider, entity: entity.id, name: entity.name, unit: entity.unit ?? "", type: typeOf(entity),
        })}">${t`Add datapoint`}</button>`}
    </tr>`)}
    </tbody>
  </table>`;
}

/** The action's data fields are built in the browser from its `input` schema (pub/main.js). */
export function renderActions(app: App, provider: number, list: Action[], endpoints: Entity[]): Promise<HtmlString> {
  const t = app.t, id = (name: string) => `home-action-${provider}-${name}`;
  if (!list.length) return html.async`<p>${t`No actions were found.`}</p>`;
  return html.async`<form data-home-action data-provider="${provider}">
    <table class="u2-table -Fields -Flex">
      <tbody>
        ${field(id("action"), t`Action`, html.async`<input id="${id("action")}" name=action list="${id("list")}" required
            autocomplete=off placeholder="${t`Search an action`}">
          <datalist id="${id("list")}">
            ${list.map((action) => html`<option value="${action.id}" data-description="${action.description ?? ""}"
              data-input="${JSON.stringify(action.input ?? {})}" data-targets="${JSON.stringify(action.targets ?? null)}"
              >${action.name === action.id ? "" : action.name}</option>`)}
          </datalist>
          <small data-action-info></small>`)}
        <tr data-targets hidden>
          <th><label for="${id("entities")}">${t`Targets`}</label></th>
          <td><select id="${id("entities")}" name=entities multiple size=6>
            ${endpoints.map((entity) => html`<option value="${entity.id}">${entity.name} (${entity.id})</option>`)}
          </select></td>
        </tr>
      </tbody>
      <tbody data-fields>
        ${field(id("data"), t`Data (JSON object)`, html`<textarea id="${id("data")}" name=data rows=4>{}</textarea>`)}
      </tbody>
      <tbody>
        ${field(id("name"), t`Command name`, html.async`<input id="${id("name")}" name=name maxlength=191
          placeholder="${t`Needed to save as command`}">`)}
        ${field(id("parameter"), t`Parameter (optional)`, html.async`<input id="${id("parameter")}" name=parameter
          maxlength=191 list="${id("parameters")}" placeholder="${t`Data path of a run-time value, e.g. data.command`}">
          <datalist id="${id("parameters")}" data-parameters></datalist>`)}
      </tbody>
    </table>
    <button type=submit>${t`Execute action`}</button>
    <button type=submit value=save formnovalidate>${t`Save as command`}</button>
    <button type=reset>${t`New`}</button>
  </form>`;
}
