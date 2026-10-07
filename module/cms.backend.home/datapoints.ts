import { errMsg, html } from "@qino/qino";
import { at, datapoint, datapoints, entities, providers as stored } from "@qino/qino/home";
import { history } from "@qino/qino/home.history";
import { chart, format } from "@qino/qino/cms.cont.home.chart";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import { dialog, field, link } from "./render.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Datapoint, Provider } from "@qino/qino/home";

/** Edit form, or creation form when given providers. Source, unit and datatype are fixed after creation. */
export function datapointForm(app: App, point: Partial<Datapoint>, providers?: Provider[]): Promise<HtmlString> {
  const t = app.t, fixed = point.id !== undefined, lock = fixed ? html.raw("readonly") : "";
  const entry = (state = "", code?: number) => html.async`<tr>
    <td><input data-state value="${state}" aria-label="${t`State`}" ${lock}></td>
    <td><input data-code type=number min=-128 max=127 step=1 value="${code}" aria-label="${t`Code`}" ${lock}></td>
  </tr>`;
  const id = (name: string) => `home-point-${point.id ?? "new"}-${name}`;
  const source = providers ? html.async`
    ${field(id("provider"), t`Provider`, html.async`<select id="${id("provider")}" name=provider required>
      ${providers.map((provider) => html`<option value="${provider.id}">${provider.name} (#${provider.id})</option>`)}
    </select>`)}
    ${field(id("entity"), t`Entity ID (optional)`, html`<input id="${id("entity")}" name=entity maxlength=191>`)}
    ${field(id("path"), t`Path (optional)`, html.async`<input id="${id("path")}" name=path maxlength=191
      placeholder="${t`Attribute, e.g. brightness; empty for the state`}">`)}` : "";
  return html.async`<form data-datapoint data-id="${point.id}">
    <table class="u2-table -Fields -Flex">
      ${source}
      ${field(id("name"), t`Name`,
        html`<input id="${id("name")}" name=name value="${point.name}" required maxlength=191>`)}
      ${field(id("unit"), t`Unit`,
        html`<input id="${id("unit")}" name=unit value="${point.unit}" maxlength=64 ${lock}>`)}
      ${field(id("type"), t`Datatype`, html.async`<select id="${id("type")}" name=type ${fixed ? html.raw("disabled") : ""}>
        <option value=number ${point.type !== "state" ? html.raw("selected") : ""}>${t`Number`}</option>
        <option value=state ${point.type === "state" ? html.raw("selected") : ""}>${t`Discrete state`}</option>
      </select>`)}
      ${field(id("interval"), t`Expected interval (seconds; 0 disables stale detection)`,
        html`<input id="${id("interval")}" name=interval type=number min=0 step=1 value="${point.interval ?? 0}">`)}
      ${field(id("record"), t`Record observations`,
        html`<input id="${id("record")}" name=record type=checkbox ${point.record ? html.raw("checked") : ""}>`)}
    </table>
    <fieldset data-mapping ${point.type === "state" ? "" : html.raw("hidden")}>
      <legend>${t`State mapping`}</legend>
      <p>${t`Map text states to integer codes. Boolean states use 0 and 1 automatically.`}</p>
      <table class=u2-table><tbody>
        ${Object.entries(point.mapping ?? {}).map(([state, code]) => entry(state, code))}${fixed ? "" : entry()}
      </tbody></table>
      ${fixed ? "" : html.async`<template data-map-row>${entry()}</template>
        <button type=button data-add-map>${t`Add state`}</button>`}
    </fieldset>
    <button type=submit>${t`Save datapoint`}</button>
  </form>`;
}

/** The datapoints; settings, measurements and new datapoints in dialogs. */
const { uniqueColor, ageColor } = backend;

/** A dialog to store a value by hand, e.g. a meter reading. */
function entry(app: App, point: Datapoint): Promise<HtmlString> {
  const t = app.t, id = (name: string) => `home-measurement-${point.id}-${name}`;
  return dialog(t`Enter measurement`, point.name, html.async`<form data-measurement data-id="${point.id}">
    <table class="u2-table -Fields -Flex">
      ${field(id("value"), html.async`${t`Value`} (${point.unit || point.type})`, html`<input id="${id("value")}"
        name=value type=number required step="${point.type === "state" ? "1" : "any"}"
        ${point.type === "state" ? html.raw("min=-128 max=127") : ""}>`)}
      ${field(id("time"), t`Time (optional; empty means now)`,
        html`<input id="${id("time")}" name=time type=datetime-local step=0.001>`)}
    </table>
    <button type=submit>${t`Save measurement`}</button>
  </form>`);
}

/** A recorded value as read: state codes by their text. */
const shown = (point: Datapoint, value: number | null) => value === null ? "—" : point.type === "state"
  ? Object.entries(point.mapping).find(([, code]) => code === value)?.[0] ?? String(value)
  : `${format(value)}${point.unit ? ` ${point.unit}` : ""}`;

export async function measurements(
  node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {},
): Promise<HtmlString> {
  const app = node.app, t = app.t, q = String(vars.q ?? "").toLowerCase();
  const [all, providers] = await Promise.all([datapoints(app), stored(app)]);
  const points = all.filter((point) => (!vars.provider || String(point.provider) === String(vars.provider))
    && (!q || [point.name, point.entity, point.path].some((part) => part.toLowerCase().includes(q))));
  const recording = app.modules.linked("home.record"), enabled = providers.filter((provider) => provider.enabled);
  return html.async`
    ${recording ? "" : html.async`<p>${t`Install home.record to store selected observations locally.`}</p>`}
    ${enabled.length
      ? html.async`<p><button type=button data-add-point>${t`Add datapoint`}</button></p>
        <template data-new-point><h3>${t`Add datapoint`}</h3>${datapointForm(app, { record: true }, enabled)}</template>`
      : html.async`<p>${t`Enable a provider to add datapoints.`}</p>`}
    ${points.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`ID`}
        <th>${t`Datapoint`}
        <th>${t`Last value`}
        <th>${t`Record`}
        <th>
      <tbody>${points.map((point) => html.async`<tr u2-href>
        <td>${point.id}</td>
        <td><a href="${link(node, { datapoint: point.id })}">${point.name}</a>
          <br><code style="color:${uniqueColor(point.entity)}">
            ${point.entity}${point.path ? `/${point.path}` : ""}</code></td>
        <td>${shown(point, point.value)}<br>
          <span style="color:${point.time === null ? "" : ageColor(point.time / 1000)}">
            ${u2.el.time(point.time === null ? null : new Date(point.time))}</span></td>
        <td><input type=checkbox data-record data-id="${point.id}" aria-label="${t`Record`} ${point.name}"
          ${point.record ? html.raw("checked") : ""}></td>
        <td>
          ${dialog(t`Settings`, point.name, datapointForm(app, point))}
          ${recording && point.record ? entry(app, point) : ""}
        </td>
      </tr>`)}</tbody>
    </table>` : html.async`<p>${all.length ? t`No datapoints match.` : t`No datapoints yet.`}</p>`}`;
}

/** One datapoint: what it reads and how, its live and last recorded value, the last day as chart and samples. */
export async function detail(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const point = await datapoint(app, Number(vars.datapoint)).catch(() => undefined);
  if (!point) return html.async`<div class=u2-card>
    <div class=-head>${t`Datapoint`}</div>
    <nav><a href="${link(node)}"><u2-ico icon=arrow_back>←</u2-ico> ${t`Providers`}</a></nav>
    <p>${t`The datapoint was not found.`}</p>
  </div>`;
  const recording = app.modules.linked("home.record");
  const provider = (await stored(app)).find((row) => row.id === point.provider);
  const entity = await entities(app, point.provider)
    .then((list) => list.find((entity) => entity.id === point.entity) ?? null, () => null);
  const end = Date.now(), start = end - 86_400_000;
  const period = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  const [plotted, raw] = await Promise.all([
    history(app, point.id, { ...period, width: 300 }).catch((error: unknown) => error),
    history(app, point.id, period).catch((error: unknown) => error),
  ]);
  const ok = (result: unknown): result is Awaited<ReturnType<typeof history>> => !(result instanceof Error);
  const live = entity ? at(entity, point.path) : undefined;
  return html.async`<div class=u2-card>
    <div class=-head>${point.name}</div>
    <nav><a href="${link(node, { provider: point.provider })}"><u2-ico icon=arrow_back>←</u2-ico>
      ${provider?.name ?? point.provider}</a></nav>
    <table class=u2-table>
      <tr>
        <th>${t`ID`}
        <td>${point.id}
      <tr>
        <th>${t`Provider`}
        <td style="color:${uniqueColor(provider?.name ?? point.provider)}">${provider?.name ?? point.provider}
      <tr>
        <th>${t`Address`}
        <td><code style="color:${uniqueColor(point.entity)}">${point.entity}${point.path ? `/${point.path}` : ""}</code>
      <tr>
        <th>${t`Datatype`}
        <td>${point.type === "state" ? t`Discrete state` : t`Number`}${point.unit ? ` · ${point.unit}` : ""}
          ${Object.keys(point.mapping).length ? html`<br><small>${
            Object.entries(point.mapping).map(([state, code]) => `${state} = ${code}`).join(", ")}</small>` : ""}
      <tr>
        <th>${t`Live`}
        <td>${live === undefined ? "—" : typeof live === "string" ? live : JSON.stringify(live)}
          ${entity && !entity.available ? html.async` (${t`Unavailable`})` : ""}
      <tr>
        <th>${t`Last recorded`}
        <td>${shown(point, point.value)} ${u2.el.time(point.time === null ? null : new Date(point.time))}
      <tr>
        <th>${t`Expected interval`}
        <td>${point.interval ? `${point.interval} s` : "—"}
      <tr>
        <th>${t`Record`}
        <td><input type=checkbox data-record data-id="${point.id}" aria-label="${t`Record`} ${point.name}"
          ${point.record ? html.raw("checked") : ""}>
    </table>
    <p class=u2-flex>
      ${dialog(t`Settings`, point.name, datapointForm(app, point))}
      ${recording && point.record ? entry(app, point) : ""}
    </p>
  </div>
  <div class=u2-card>
    <div class=-head>${t`Last 24 hours`}</div>
    <div>${!ok(plotted) ? html`<p role=alert>${errMsg(plotted)}</p>`
      : chart(plotted.samples, { start, end, unit: point.unit, discrete: point.type === "state" })
        ?? html.async`<p>${t`No observations in this period.`}</p>`}</div>
    ${ok(raw) && raw.samples.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`Time`}
        <th>${t`Value`}
      <tbody>${raw.samples.slice(-20).reverse().map((sample) => html`<tr>
        <td>${u2.el.time(new Date(sample.time))}
        <td>${shown(point, sample.value)}
      </tr>`)}</tbody>
    </table>` : ""}
  </div>`;
}
