import { hee, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { duplicates, keyOf, merge, references } from "./lib/merge.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Merge entries", de: "Einträge zusammenführen" });
}

/** The page's last choice: table, fields that must be equal, an SQL condition. */
const settingsSchema = {
  properties: {
    table: { type: "string" },
    same: { type: "string", description: "Comma-separated columns rows must share to be duplicates." },
    where: { type: "string", description: "SQL condition the rows must meet (trusted: superusers only)." },
  },
};

const show = (v: unknown) => v == null ? html`<i>NULL</i>` : v === "" ? html`<i>""</i>` : String(v);
const empty = (v: unknown) => v == null || v === "";

async function config(node: Node) {
  const table = String(await node.settings.table ?? "");
  const same = String(await node.settings.same ?? "").split(",").filter(Boolean);
  return { table, same, where: String(await node.settings.where ?? "") };
}

/** One group of duplicates side by side: the kept row is chosen per group, the oldest by default. */
async function group(node: Node, table: string, rows: Row[], same: string[], n: number): Promise<HtmlString> {
  const db = node.app.db, key = keyOf(db, table)!;
  const refs = await Promise.all(rows.map((r) => references(db, table, r[key])));
  const columns = Object.keys(rows[0]);
  return html.async`<table class=u2-table data-group=${n}>
    <thead><tr>
      <th>
      ${rows.map((r, i) => html`<th><label><input type=radio name=keep-${n} value="${String(r[key])}"${i ? "" : " checked"}> keep #${String(r[key])}</label>`)}
    <tbody>
      ${columns.map((c) => html`<tr>
        <th${same.includes(c) ? html` style="font-weight:bold"` : ""}>${c}
        ${rows.map((r) => {
          // a field the rows disagree on: whichever row is kept, its value wins, an empty one is filled
          const differs = !empty(r[c]) && new Set(rows.map((o) => empty(o[c]) ? "" : String(o[c]))).size > 1;
          return html`<td>${differs ? html`<mark>${show(r[c])}</mark>` : show(r[c])}`;
        })}`)}
      ${refs[0].map((ref, i) => html`<tr>
        <th>→ ${ref.field.table}.${String(ref.field)}
        ${refs.map((rs) => html`<td>${rs[i].count}`)}`)}
      <tr>
        <th>
        ${rows.map((r) => html`<td><button type=button data-merge="${String(r[key])}">merge into the kept one</button>`)}
  </table>`;
}

async function groups(node: Node): Promise<HtmlString> {
  const { table, same, where } = await config(node);
  if (!table || !keyOf(node.app.db, table)) return html`<p>Choose a table with a single key column.</p>`;
  if (!same.length) return html`<p>Choose the fields duplicates share.</p>`;
  const found = await duplicates(node.app.db, table, same, where);
  if (!found.length) return html`<p>No duplicates.</p>`;
  return html.async`<p>${found.length} groups${found.length === 50 ? " (the first 50)" : ""}. Merging moves every reference to
    the kept row, fills its empty fields and deletes the other. Marked: fields the rows disagree on.</p>
    ${found.map((rows, n) => group(node, table, rows, same, n))}`;
}

async function render(node: Node): Promise<HtmlString> {
  const db = node.app.db, { table, same, where } = await config(node);
  const tables = (await db.listTables()).filter((t) => keyOf(db, t)).sort();
  const columns = table && keyOf(db, table) ? (await db.columns(table)).map((c) => String(c.Field)) : [];
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 20rem">
      <div class=-head>Merge entries</div>
      <form data-config>
        <label>Table<br><select name=table>
          <option value="">–
          ${tables.map((t) => html`<option${t === table ? " selected" : ""}>${t}`)}
        </select></label>
        ${columns.length ? html`<fieldset><legend>Duplicates share</legend>
          ${columns.map((c) => html`<label style="display:block"><input type=checkbox name=same value="${c}"${same.includes(c) ? " checked" : ""}> ${c}</label>`)}
        </fieldset>
        <label>Only rows where (SQL)<br><textarea name=where rows=2>${where}</textarea></label>
        <button>Show duplicates</button>` : ""}
      </form>
    </div>
    <div class=u2-card style="flex:1 1 30rem; min-width:0">
      <div class=-head>Duplicates${table ? html` in ${table}` : ""}</div>
      <div style="overflow:auto" cms-part=groups>${groups(node)}</div>
    </div>
  </div>`;
}

/** What the page asks: keep its choice, merge one row into another. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (vars.configure) {
    const table = String(vars.table ?? "");
    if (table && !keyOf(node.app.db, table)) return { error: "unknown table" };
    const columns = table ? (await node.app.db.columns(table)).map((c) => String(c.Field)) : [];
    const same = [vars.same ?? []].flat().map(String).filter((c) => columns.includes(c));
    const before = (await config(node)).table; // another table: its fields start unchosen
    await node.settings.table(table);
    await node.settings.same(table === before ? same.join(",") : "");
    await node.settings.where(String(vars.where ?? ""));
    return { done: true };
  }
  if (vars.merge) {
    const { table } = await config(node);
    const result = await merge(node.app.db, table, vars.into, vars.merge).catch((e) => ({ error: String(e?.message ?? e) }));
    if ("error" in result) return result;
    const moved = Object.entries(result.moved).map(([ref, n]) => `${n} × ${ref}`).join(", ") || "no references";
    return { message: hee(`#${vars.merge} merged into #${vars.into}: ${moved} moved${result.dropped ? `, ${result.dropped} duplicates dropped` : ""}` +
      (result.filled.length ? `, filled: ${result.filled.join(", ")}` : "")) };
  }
  return { error: "unknown action" };
}

export const cms = { node: { render, api, settingsSchema, parts: { groups }, js: ["pub/main.js"] } };
