import { html, unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { scopes, strength } from "@qino/qino/score";

import { TABLES } from "./hooks.ts";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card">
    <div class=-head>
      <span>${t`Score test`}</span>
      <button type=button data-clear u2-confirm="${t`Delete all scores collected here?`}">${t`Clear`}</button>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <div>
      <p>${t`This module feeds the score tables from two hooks that already exist — nothing else in qino writes scores yet.`}
      <ul>
        <li><code>cms:page-ready</code> → <code>page</code>:
          ${t`one hit per rendered page, skipping error pages, the backend (editmode) and bots.`}
        <li><code>dbFile:access</code> → <code>file</code>:
          ${t`one hit per delivered file. That hook is really the permission check, so only requests on the`}
          <code>dbFile/</code> ${t`route are counted.`}
      </ul>
      <p>${t`Unlink this module to stop collecting; the scores stay and the Scores page keeps showing them.`}
    </div>
    <div cms-part=list>${list(node)}</div>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const rows: HtmlString[] = [];
  for (const tbl of Object.keys(TABLES)) rows.push(await renderRow(node.app, tbl));
  return html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>${node.app.t`Table`}
      <th>${node.app.t`Half-life`}
      <th>${node.app.t`Scored rows`}
      <th>${node.app.t`Last hit`}
    <tbody>${rows}
  </table>
  ${renderPages(node.app)}`;
}

/** The scored pages themselves — the point of the test is seeing real pages ranked. */
async function renderPages(app: App): Promise<HtmlString> {
  const scope = scopes(app.db).get("page");
  const top = scope
    ? await app.db.query<{ id: number; score: number; time: number }>`
      SELECT id, score, time FROM score WHERE scope_id = ${scope.id} ORDER BY score DESC LIMIT 10`
    : [];
  if (!top.length) return html``;
  const now = unixTime();
  const rows: HtmlString[] = [];
  for (const row of top) rows.push(await renderPage(app, row, now));

  return html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>${app.t`Page`} <small>${app.t`looked up`}</small>
      <th><code>score</code> <small>db</small>
      <th>${app.t`Strength`} <small>${app.t`computed`}</small>
      <th><code>time</code> <small>db</small>
    <tbody>${rows}
  </table>`;
}

async function renderPage(app: App, row: { id: number; score: number; time: number }, now: number): Promise<HtmlString> {
  const node = await cms(app).node(Number(row.id)).catch(() => undefined);
  const page = node?.exists();
  const title = page ? String((await (await page.title())?.string()) ?? "").replace(/<[^>]+>/g, "").trim() : "";
  const url = page ? await page.url().catch(() => "") : "";
  const label = title || html`#${row.id}`;

  return html`<tr>
    <td>${url ? html`<a href="${url}">${label}</a>` : label}
    <td><code>${Number(row.score).toFixed(3)}</code>
    <td>${accesses(strength(app.db, "page", Number(row.score), now))}
    <td>${time(Number(row.time))}`;
}

/** Stored score → decayed accesses. Not a view count: a hit adds 1 now and keeps fading from there. */
function accesses(value: number): string {
  return value < 10 ? value.toFixed(2) : String(Math.round(value));
}

async function renderRow(app: App, tbl: string): Promise<HtmlString> {
  const scope = scopes(app.db).get(tbl);
  if (!scope) return html`<tr><td><code>${tbl}</code><td colspan=3>${await app.t`not registered`}`;
  const stats = await app.db.row<{ total: number; last: number }>`
    SELECT COUNT(*) AS total, MAX(time) AS last FROM score WHERE scope_id = ${scope.id}`;

  return html`<tr>
    <td><code>${tbl}</code>
    <td>${Math.round(scope.half / 86400)}d
    <td>${Number(stats?.total ?? 0)}
    <td>${time(Number(stats?.last ?? 0))}`;
}

function time(value: number): HtmlString {
  if (!value) return html`–`;
  return html`<u2-time datetime="${new Date(value * 1000).toISOString()}" second type=relative></u2-time>`;
}
