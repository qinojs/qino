import { errMsg, html } from "@qino/qino";
import { actions, commands, datapoint, datapoints, entities, leaves, providers } from "@qino/qino/home";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import { additions, settings } from "./settings.ts";
import { datapointForm, detail, measurements } from "./datapoints.ts";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Action, Command, Entity, Provider } from "@qino/qino/home";

type Vars = Record<string, unknown>;
// Same value, same color; fresh times stand out: as in the other backend lists.
const { uniqueColor, ageColor } = backend;
/** More values than this: narrow the search. */
const LIMIT = 200;

const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "";
const typeOf = (value: unknown) =>
  typeof value === "boolean" || typeof value === "string" && !Number.isFinite(Number(value)) ? "state" : "number";

/** The page's views, each a cms-part. The address picks one: none the providers, `?provider=` one provider
 *  (`show`: live, datapoints, actions), `?datapoint=` one datapoint. */
export const views = { providers: settings, live, datapoints: measurements, actions: control, datapoint: detail };
const tabs = ["live", "datapoints", "actions"] as const;

/** A link to this page with `params`; from a part too, whose own request is the api's. */
export async function link(node: Node, params: Vars = {}): Promise<string> {
  // The node's url may carry an anchor (`#cmspid…`): the parameters go before it.
  const url = new URL(await node.url(), "http://base.invalid");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.pathname + url.search + url.hash;
}

export async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app, t = app.t, vars = ctx.req.query as Vars;
  const point = Number(vars.datapoint)
    ? await datapoint(app, Number(vars.datapoint)).catch(() => undefined) : undefined;
  const id = point?.provider ?? (Number(vars.provider) || 0);
  const row = id ? (await providers(app)).find((row) => row.id === id) : undefined;
  const show = String(vars.show ?? "");
  const current: keyof typeof views = point ? "datapoint"
    : !row ? "providers" : (tabs as readonly string[]).includes(show) ? show as typeof tabs[number] : "live";
  const labels = { live: t`Live`, datapoints: t`Datapoints`, actions: t`Actions` };
  const part = { ...vars, ...row ? { provider: row.id } : {} };
  const view = html.async`<div cms-part=${current} style="display:contents">
    ${views[current](node, { vars: part })}
  </div>`;
  const refresh = html.async`<button type=button data-refresh>${t`Refresh`}</button>`;
  // A datapoint is several cards side by side, each with its own head; see detail().
  if (point) return html.async`<div class=u2-flex>${view}</div>`;
  // Heads hold titles only; navigation and buttons go into the card.
  if (!row) return html.async`<section class=u2-card>
    <div class=-head>${t`Providers`}</div>
    ${view}
    <div class=u2-flex>${additions(node)} ${refresh}</div>
  </section>`;
  return html.async`<section class=u2-card>
    <div class=-head>${row.name}</div>
    <nav class=u2-flex>
      <a href="${link(node)}"><u2-ico icon=arrow_back>←</u2-ico> ${t`Providers`}</a>
      ${tabs.map((name) => html.async`<a href="${link(node, { provider: row.id, show: name })}"
        ${name === current ? html.raw("aria-current=page") : ""}>${labels[name]}</a>`)}
    </nav>
    <form class="u2-flex -filter" data-filter>
      ${current === "actions" ? "" : html.async`<input type=search name=q value="${vars.q}"
        placeholder="${t`Search, also attributes`}" aria-label="${t`Search`}">`}
      ${refresh}
    </form>
    ${view}
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

type Value = { provider: Provider; entity: Entity; path: string; value: unknown };

/** Likely values of a state: a list attribute that holds the current one (event types, select options). */
const options = (entity: Entity, value: unknown) => typeof value !== "string" ? [] : (Object
  .values(entity.attributes).find((list) => Array.isArray(list) && list.includes(value)) as string[] | undefined)
  ?.filter((option) => typeof option === "string") ?? [value];

/** Every value of the enabled providers' entities as one row: their states, and when searching also their
 *  attribute leaves; searching `/` lists them all. */
export async function live(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t, rows = await enabled(app);
  if (!rows.length) return html.async`<p>${t`No provider is enabled.`}</p>`;
  const selected = rows.filter((row) => !vars.provider || String(row.id) === String(vars.provider));
  const results = await Promise.all(selected.map(async (row) =>
    [row, await entities(app, row.id).catch((error: unknown) => error)] as const));
  const q = String(vars.q ?? "").toLowerCase();
  const found = results.flatMap(([provider, list]) => Array.isArray(list) ? list.flatMap((entity: Entity) =>
    leaves(entity).filter(([path]) => q || !path).map(([path, value]) => ({ provider, entity, path, value })))
    : []).filter(({ entity, path, value }) =>
      !q || [path ? `${entity.id}/${path}` : entity.id, entity.name, text(value)]
        .some((part) => part.toLowerCase().includes(q)));
  // Values that already are datapoints lead to them instead of offering a new one.
  const points = new Map(await Promise.all((await datapoints(app)).map(async (point) =>
    [`${point.provider} ${point.entity} ${point.path}`, await link(node, { datapoint: point.id })] as const)));
  return html.async`<template data-new-point>
      <h3>${t`Add datapoint`}</h3>${datapointForm(app, { record: true }, rows)}
    </template>
    ${results.filter(([, list]) => !Array.isArray(list))
      .map(([row, error]) => html`<p role=alert>${row.name}: ${errMsg(error)}</p>`)}
    ${renderValues(app, found.slice(0, LIMIT), points)}
    ${found.length > LIMIT ? html.async`<p>${found.length - LIMIT} ${t`more; narrow the search.`}</p>` : ""}`;
}

/** Per enabled provider (`provider`: one): its stored commands and a form to call an action or store one. */
export async function control(node: Node, { vars = {} }: { vars?: Vars } = {}): Promise<HtmlString> {
  const app = node.app, stored = await commands(app);
  const rows = (await enabled(app)).filter((row) => !vars.provider || String(row.id) === String(vars.provider));
  if (!rows.length) return html.async`<p>${app.t`No provider is enabled.`}</p>`;
  return html.join(await Promise.all(rows.map(async (row) => {
    const [endpoints, list] = await Promise.allSettled([entities(app, row.id), actions(app, row.id)]);
    const own = stored.filter((command) => command.provider === row.id);
    const known = list.status === "fulfilled" ? list.value : [];
    return html.async`${rows.length > 1 ? html`<h3>${row.name}</h3>` : ""}
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
function runner(app: App, command: Command, actions: Action[]) {
  const t = app.t;
  if (!command.parameter) return html.async`<button type=button data-run="${command.id}">${t`Run`}</button>`;
  const schema = schemaAt(actions.find((action) => action.id === command.action)?.input, command.parameter);
  const number = schema?.type === "number" || schema?.type === "integer";
  return html.async`<form data-run-command data-id="${command.id}" class=u2-flex>
    <input name=value required aria-label="${command.parameter}" placeholder="${command.parameter}"
      data-type="${number ? "number" : "auto"}" ${number ? html`type=number step=any min="${schema.minimum}"
      max="${schema.maximum}"` : ""}>
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

/** Values as rows; each can become a datapoint, or leads to it (`points`: its link by `provider entity path`).
 *  An address is the entity, plus `/path` for an attribute. */
export function renderValues(app: App, values: Value[], points = new Map<string, string>()): Promise<HtmlString> {
  const t = app.t;
  if (!values.length) return html.async`<p>${t`No values were found.`}</p>`;
  return html.async`<table class=u2-table>
    <thead><tr>
      <th>${t`Address`}
      <th>${t`Value`}
      <th>${t`Availability`}
      <th>${t`Updated`}
      <th>
    <tbody>${values.map(({ provider, entity, path, value }) => {
      const point = points.get(`${provider.id} ${entity.id} ${path}`);
      return html.async`<tr ${point ? html.raw("u2-href") : ""}>
        <td>${entity.name}${path ? ` · ${path}` : ""}
          <br><code style="color:${uniqueColor(entity.id)}">${entity.id}${path ? `/${path}` : ""}</code>
        <td>${text(value)}${!path && entity.unit ? ` ${entity.unit}` : ""}
        <td>${entity.available ? t`Available` : t`Unavailable`}
        <td style="color:${entity.updated ? ageColor(Date.parse(entity.updated) / 1000) : ""}">
          ${u2.el.time(entity.updated)}
        <td>${point ? html.async`<a href="${point}">${t`Datapoint`}</a>` : html.async`<button type=button
          data-add-point="${JSON.stringify({
            provider: provider.id, entity: entity.id, path, name: path ? `${entity.name} ${path}` : entity.name,
            unit: path ? "" : entity.unit ?? "", type: typeOf(value), options: options(entity, value),
          })}">${t`Add datapoint`}</button>`}
      </tr>`;
    })}
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
            ${list.map((action) => html`<option value="${action.id}" data-description="${action.description}"
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
