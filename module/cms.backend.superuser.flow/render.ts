import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString } from "@qino/qino";

type Row = Record<string, unknown>;
type Step = { description?: string; fn?: string; debounce?: { ms: number; by?: string } };

const steps = (row: Row): Step[] => JSON.parse(String(row.steps || "[]"));

/** The flows: what starts them, whose they are, whether they listen and whether only as a test. */
export async function renderList(app: App, rows: Row[]): Promise<HtmlString> {
  const { t } = app;
  const [tNone, tConfirm, ...labels] = await Promise.all([
    t`No flows yet — an AI or the api makes them.`, t`Really delete this flow?`,
    t`Flow`, t`Event`, t`Owner`, t`Active`, t`Test`,
  ]);
  const trs = rows.map((row) => html`<tr data-flow="${row.id}">
      <td>${row.description || html`<small>#${row.id}</small>`}
      <td><code>${row.host}</code> <code>${row.event}</code>
      <td>${row.owner}
      <td><input type=checkbox data-set=active${row.active ? html.raw(" checked") : ""}>
      <td><input type=checkbox data-set=test${row.test ? html.raw(" checked") : ""}>
      <td><button data-delete class=u2-unstyle u2-confirm="${tConfirm}"><u2-ico icon=delete>✕</u2-ico></button>`);
  return html`<thead><tr>${labels.map((label) => html`<th>${label}`)}<th width=40>
<tbody>${trs.length ? trs : html`<tr><td colspan=6>${tNone}`}`;
}

type Schema = { type?: string; description?: string; properties?: Record<string, Schema> };

/** An event as its schema describes it: empty values of each field's type, null where it has none. */
const example = (schema: Schema): unknown =>
  schema.properties
    ? Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, example(v)]))
    : ({ string: "", number: 0, integer: 0, boolean: false, array: [], object: {} } as Record<string, unknown>)[
      schema.type ?? ""
    ] ?? null;

/** One flow as the sections of a card, to edit: its event, tools and steps; and a test run on an example
 *  event. `events`: what it may listen to (`host event`); `schema`: its event's data, for the example. */
export async function renderDetail(
  app: App,
  row: Row | undefined,
  { events = [], schema, history }: {
    events?: string[];
    schema?: Schema;
    history?: { runs: { time: Date; end: string }[]; filtered: number };
  } = {},
): Promise<HtmlString> {
  const { t } = app;
  const [tSteps, tPick, tDescription, tWhen, tTools, tOnePerLine, tCode, tWait, tBy, tRemove, tSave, tEvent, tTry] =
    await Promise.all([
      t`Steps`, t`Pick a flow.`, t`Description`, t`When`, t`May use`, t`one tool per line`, t`Code`, t`Wait`,
      t`per`, t`Remove`, t`Save`, t`Example event (JSON)`, t`Test run`,
    ]);
  const [tRuns, tFiltered, tNoRuns, tReload] = await Promise.all([
    t`Runs since the start`, t`not for it (stopped at the first step)`, t`No runs yet.`, t`Reload`,
  ]);
  if (!row) return html`<div class=-head>${tSteps}</div><p><small>${tPick}</small></p>`;

  const tools: string[] = JSON.parse(String(row.tools || "[]"));
  const on = `${row.host} ${row.event}`;
  const remove = html`<button type=button data-remove-step class=u2-unstyle title="${tRemove}">
    <u2-ico icon=delete>✕</u2-ico></button>`;
  // one step to edit; empty ones are the templates "add" clones
  const step = ({ description = "", fn, debounce }: Step) => html`<fieldset data-step=${debounce ? "debounce" : "fn"}>
    <legend><input name=description value="${description}" placeholder="${tDescription}"> ${remove}</legend>
    ${debounce
      ? html`${tWait} <input type=number name=ms min=0 value="${debounce.ms}"> ms
        ${tBy} <input name=by value="${debounce.by ?? ""}">`
      : html`<u2-code trim language=js><textarea name=fn rows=3>${fn ?? ""}</textarea></u2-code>`}
  </fieldset>`;
  const fields = schema?.properties
    ? html`<dl>${Object.entries(schema.properties).map(([name, field]) =>
      html`<dt><code>${name}</code> <small>${field.type ?? ""}</small><dd>${field.description ?? ""}`)}</dl>`
    : "";

  return html`<div class=-head>${row.description || `#${row.id}`}</div>
<form data-edit>
  <u2-fields>
    ${tDescription} <input name=description value="${row.description ?? ""}">
    ${tWhen} <select name=on>${[...new Set([on, ...events])].map((e) =>
      html`<option${e === on ? html.raw(" selected") : ""}>${e}</option>`)}</select>
    ${tTools} <textarea name=tools rows=3 placeholder="${tOnePerLine}">${tools.join("\n")}</textarea>
  </u2-fields>
  <div data-steps>${steps(row).map(step)}</div>
  <p>
    <button type=button data-add-step=fn>+ ${tCode}</button>
    <button type=button data-add-step=debounce>+ ${tWait}</button>
    <button>${tSave}</button>
  </p>
  <template data-step-template=fn>${step({})}</template>
  <template data-step-template=debounce>${step({ debounce: { ms: 120_000 } })}</template>
</form>
<hr>
<div>
  <b>${tRuns}</b> <button type=button data-reload class=u2-unstyle title="${tReload}">↻</button>
  ${history?.filtered ? html`<br><small>${history.filtered}× ${tFiltered}</small>` : ""}
  ${history?.runs.length
    ? history.runs.map((run) => html`<details>
    <summary>${u2.el.time(run.time, { second: true })} · ${run.end}</summary>
    <u2-code trim language=json><textarea readonly>${JSON.stringify(run, null, 2)}</textarea></u2-code>
  </details>`)
    : html`<p><small>${tNoRuns}</small></p>`}
</div>
<hr>
<form data-test>
  <b>${tTry}</b>
  ${fields}
  <label>${tEvent}<u2-code trim language=json><textarea name=event rows=6>${
    JSON.stringify(schema ? example(schema) : {}, null, 2)
  }</textarea></u2-code></label>
  <button>${tTry}</button>
</form>`;
}
