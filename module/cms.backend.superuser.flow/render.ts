import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { App, HtmlString } from "@qino/qino";

type Row = Record<string, unknown>;

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

/** One flow as the sections of a card, to edit: its event, tools and code; and a test run on an
 *  example event. `events`: what it may listen to (`host event`); `schema`: its event's data, for the example. */
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
  const [tFlow, tPick, tDescription, tWhen, tTools, tOnePerLine, tCode, tSave, tEvent, tTry] = await Promise.all([
    t`Flow`, t`Pick a flow.`, t`Description`, t`When`, t`May use`, t`one tool per line`, t`Code`, t`Save`,
    t`Example event (JSON)`, t`Test run`,
  ]);
  const [tRuns, tFiltered, tNoRuns, tReload] = await Promise.all([
    t`Runs since the start`, t`not for it (no tool call, no result)`, t`No runs yet.`, t`Reload`,
  ]);
  if (!row) return html`<div class=-head>${tFlow}</div><p><small>${tPick}</small></p>`;

  const tools: string[] = JSON.parse(String(row.tools || "[]"));
  const on = `${row.host} ${row.event}`;
  const fields = schema?.properties
    ? html`<dl>${Object.entries(schema.properties).map(([name, field]) =>
      html`<dt><code>${name}</code> <small>${field.type}</small><dd>${field.description}`)}</dl>`
    : "";

  return html`<div class=-head>${row.description || `#${row.id}`}</div>
<form data-edit>
  <u2-fields>
    ${tDescription} <input name=description value="${row.description}">
    ${tWhen} <select name=on>${[...new Set([on, ...events])].map((e) =>
      html`<option${e === on ? html.raw(" selected") : ""}>${e}</option>`)}</select>
    ${tTools} <textarea name=tools rows=3 placeholder="${tOnePerLine}">${tools.join("\n")}</textarea>
    ${tCode} <u2-code name=x trim language=js><textarea name=code rows=10>${row.code}</textarea></u2-code>
  </u2-fields>
  <p><button>${tSave}</button></p>
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
