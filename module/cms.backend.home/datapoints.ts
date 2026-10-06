import { html } from "@qino/qino";
import { datapoints, providers as stored } from "@qino/qino/home";
import * as u2 from "@qino/qino/u2";

import { dialog, field } from "./render.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Datapoint, Provider } from "@qino/qino/home";

/** Edit form, or creation form when given providers. Source, unit and datatype are fixed after creation. */
export function datapointForm(app: App, point: Partial<Datapoint>, providers?: Provider[]): Promise<HtmlString> {
  const t = app.t, fixed = point.id !== undefined, lock = fixed ? html.raw("readonly") : "";
  const entry = (state = "", code?: number) => html.async`<tr>
    <td><input data-state value="${state}" aria-label="${t`State`}" ${lock}></td>
    <td><input data-code type=number min=-128 max=127 step=1 value="${code ?? ""}" aria-label="${t`Code`}" ${lock}></td>
  </tr>`;
  const id = (name: string) => `home-point-${point.id ?? "new"}-${name}`;
  const source = providers ? html.async`
    ${field(id("provider"), t`Provider`, html.async`<select id="${id("provider")}" name=provider required>
      ${providers.map((provider) => html`<option value="${provider.id}">${provider.name} (#${provider.id})</option>`)}
    </select>`)}
    ${field(id("entity"), t`Entity ID (optional)`, html`<input id="${id("entity")}" name=entity maxlength=191>`)}` : "";
  return html.async`<form data-datapoint data-id="${point.id ?? ""}">
    <table class="u2-table -Fields -Flex">
      ${source}
      ${field(id("name"), t`Name`,
        html`<input id="${id("name")}" name=name value="${point.name ?? ""}" required maxlength=191>`)}
      ${field(id("unit"), t`Unit`,
        html`<input id="${id("unit")}" name=unit value="${point.unit ?? ""}" maxlength=64 ${lock}>`)}
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
export async function measurements(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const [points, providers] = await Promise.all([datapoints(app), stored(app)]);
  const recording = app.modules.linked("home.record"), enabled = providers.filter((provider) => provider.enabled);
  const entry = (point: Datapoint) => {
    const id = (name: string) => `home-measurement-${point.id}-${name}`;
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
  };
  return html.async`
    ${recording ? "" : html.async`<p>${t`Install home.record to store selected observations locally.`}</p>`}
    ${enabled.length
      ? html.async`<p><button type=button data-add-point>${t`Add datapoint`}</button></p>
        <template data-new-point><h3>${t`Add datapoint`}</h3>${datapointForm(app, { record: true }, enabled)}</template>`
      : html.async`<p>${t`Enable a provider to add datapoints.`}</p>`}
    ${points.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`ID`}
        <th>${t`Provider`}
        <th>${t`Datapoint`}
        <th>${t`Last value`}
        <th>${t`Record`}
        <th>
      <tbody>${points.map((point) => html.async`<tr>
        <td>${point.id}</td>
        <td>${providers.find((provider) => provider.id === point.provider)?.name ?? point.provider}</td>
        <td>${point.name}<br><code>${point.entity}</code></td>
        <td>${point.value ?? "—"} ${point.unit}<br>${u2.el.time(point.time === null ? null : new Date(point.time))}</td>
        <td><input type=checkbox data-record data-id="${point.id}" aria-label="${t`Record`} ${point.name}"
          ${point.record ? html.raw("checked") : ""}></td>
        <td>
          ${dialog(t`Settings`, point.name, datapointForm(app, point))}
          ${recording && point.record ? entry(point) : ""}
        </td>
      </tr>`)}</tbody>
    </table>` : html.async`<p>${t`No datapoints yet.`}</p>`}`;
}
