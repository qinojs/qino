import { html } from "@qino/qino";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Datapoint } from "@qino/qino/home";

/** Source, unit and datatype are fixed after creation so old values retain their meaning. */
export function datapointForm(app: App, point: Partial<Datapoint> & { provider: number; entity: string }): Promise<HtmlString> {
  const t = app.t, fixed = point.id !== undefined;
  const entry = (state = "", code?: number) => html.async`<tr>
    <td><input data-state value="${state}" aria-label="${t`State`}" ${fixed ? html.raw("readonly") : ""}></td>
    <td><input data-code type=number min=-128 max=127 step=1 value="${code ?? ""}" aria-label="${t`Code`}" ${fixed ? html.raw("readonly") : ""}></td>
  </tr>`;
  return html.async`<form data-datapoint data-id="${point.id ?? ""}" data-provider="${point.provider}" data-entity="${point.entity}">
    <label>${t`Name`}<input name=name value="${point.name ?? point.entity}" required maxlength=191></label>
    <label>${t`Unit`}<input name=unit value="${point.unit ?? ""}" maxlength=64 ${fixed ? html.raw("readonly") : ""}></label>
    <label>${t`Datatype`}<select name=type ${fixed ? html.raw("disabled") : ""}>
      <option value=number ${point.type !== "state" ? html.raw("selected") : ""}>${t`Number`}</option>
      <option value=state ${point.type === "state" ? html.raw("selected") : ""}>${t`Discrete state`}</option>
    </select></label>
    <fieldset data-mapping ${point.type === "state" ? "" : html.raw("hidden")}>
      <legend>${t`State mapping`}</legend>
      <p>${t`Map text states to integer codes. Boolean states use 0 and 1 automatically.`}</p>
      <table class=u2-table><tbody>${Object.entries(point.mapping ?? {}).map(([state, code]) => entry(state, code))}${fixed ? "" : entry()}</tbody></table>
      ${fixed ? "" : html.async`<template data-map-row>${entry()}</template><button type=button data-add-map>${t`Add state`}</button>`}
    </fieldset>
    <label>${t`Expected interval (seconds; 0 disables stale detection)`}<input name=interval type=number min=0 step=1 value="${point.interval ?? 0}"></label>
    <label><input name=record type=checkbox ${point.record ? html.raw("checked") : ""}>${t`Record observations`}</label>
    <button type=submit>${t`Save datapoint`}</button>
  </form>`;
}

export async function measurements(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t, points = await app.api.home.datapoints.get() as Datapoint[];
  if (!points.length) return html.async`<section class=u2-card><div class=-head>${t`Datapoints`}</div><p>${t`Add datapoints from the observed entities above.`}</p></section>`;
  return html.async`<section class=u2-card>
    <div class=-head>${t`Datapoints`}</div>
    ${app.modules.linked("home.record") ? "" : html.async`<p>${t`Install home.record to store selected observations locally.`}</p>`}
    <table class=u2-table>
      <thead><tr>
        <th>${t`ID`}
        <th>${t`Provider`}
        <th>${t`Datapoint`}
        <th>${t`Last value`}
        <th>${t`Record`}
      <tbody>${points.map((point) => html.async`<tr>
        <td>${point.id}</td>
        <td>${point.provider}</td>
        <td>${point.name}<br><code>${point.entity}</code><details><summary>${t`Settings`}</summary>${datapointForm(app, point)}</details></td>
        <td>${point.value ?? "—"} ${point.unit}<br>${point.time === null ? "—" : new Date(point.time).toISOString()}</td>
        <td><input type=checkbox data-record data-point="${JSON.stringify(point)}" aria-label="${t`Record`} ${point.name}" ${point.record ? html.raw("checked") : ""}></td>
      </tr>`)}</tbody>
    </table>
  </section>`;
}
