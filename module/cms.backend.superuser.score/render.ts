import { html, sql, unixTime } from "@qino/qino";
import { fadeLimit, scopes, strength } from "@qino/qino/score";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { ScoreScope } from "@qino/qino/score";

const TOP = sql.raw("10");

type ScoreRow = { id: number; score: number; time: number };
type Stats = { total: number; faded: number; last: number };

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card -full">
    <div class=-head>
      <span>${t`Scores`}</span>
      <button type=button data-prune u2-confirm="${t`Delete all faded scores now?`}">${t`Prune now`}</button>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <div cms-part=list>${list(node)}</div>
  </div>`;
}

export async function list(node: Node): Promise<HtmlString> {
  const { app } = node;
  const { db } = app;
  const now = unixTime();
  const known = scopes(db);
  const total = Number(await db.one`SELECT COUNT(*) FROM score`);
  const cards = [];
  for (const [tbl, scope] of known) cards.push(await renderScope(app, tbl, scope, now));

  return html.async`<div class=-body>
    <b>${known.size}</b> ${app.t`scopes`} · ${total} ${app.t`scored rows`}
  </div>
  ${cards}
  ${renderStale(app, known)}`;
}

/** One scope: its numbers, then the strongest rows. */
async function renderScope(app: App, tbl: string, { id, half }: ScoreScope, now: number): Promise<HtmlString> {
  const db = app.db;
  const limit = fadeLimit(db, tbl, now);
  const stats = await db.row<Stats>`
    SELECT COUNT(*) AS total, SUM(CASE WHEN score < ${limit} THEN 1 ELSE 0 END) AS faded, MAX(time) AS last
    FROM score WHERE scope_id = ${id}`;
  const top = await db.query<ScoreRow>`
    SELECT id, score, time FROM score WHERE scope_id = ${id} ORDER BY score DESC LIMIT ${TOP}`;
  const faded = Number(stats?.faded ?? 0);

  return html.async`<div class=-body>
    <code>${tbl}</code>
    · ${app.t`half-life`} ${duration(half)}
    · <b>${Number(stats?.total ?? 0)}</b> ${app.t`rows`}
    ${faded ? html.async` · <span class=u2-badge>${faded} ${app.t`faded`}</span>` : ""}
    · ${app.t`last access`} ${time(Number(stats?.last ?? 0))}
  </div>
  ${top.length ? renderTop(app, tbl, top, now) : html.async`<div class=-body>${app.t`No accesses recorded yet.`}</div>`}`;
}

function renderTop(app: App, tbl: string, top: ScoreRow[], now: number): Promise<HtmlString> {
  const rows = top.map((row, i) =>
    html`<tr>
      <td>${i + 1}
      <td><code>${row.id}</code>
      <td><code>${Number(row.score).toFixed(3)}</code>
      <td>${accesses(strength(app.db, tbl, Number(row.score), now))}
      <td>${time(Number(row.time))}`
  );
  return html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>#
      <th>${app.t`Row`} <small>${app.t`db`}</small>
      <th><code>score</code> <small>${app.t`db`}</small>
      <th>${app.t`Strength`} <small>${app.t`computed`}</small>
      <th><code>time</code> <small>${app.t`db`}</small>
    <tbody>${rows}
  </table>`;
}

/** Scopes still in the table whose module no longer registers them — their rows are never pruned. */
async function renderStale(app: App, known: Map<string, ScoreScope>): Promise<HtmlString> {
  const all = await app.db.query<{ id: number; tbl: string }>`SELECT id, tbl FROM score_scope ORDER BY tbl`;
  const stale = all.filter((s) => !known.has(s.tbl));
  if (!stale.length) return html``;
  const label = await app.t`rows`;
  const rows = [];
  for (const { id, tbl } of stale) {
    const count = Number(await app.db.one`SELECT COUNT(*) FROM score WHERE scope_id = ${id}`);
    rows.push(html`<li><code>${tbl}</code> · ${count} ${label}`);
  }
  return html.async`<div class=-body>
    <b>${app.t`Not registered`}</b> —
    ${app.t`no module scores these tables anymore; prune skips them, delete them by hand.`}
    <ul>${rows}</ul>
  </div>`;
}

/** Strength in accesses: fractions matter near the fade limit, whole numbers above it. */
function accesses(value: number): string {
  return value < 10 ? value.toFixed(2) : String(Math.round(value));
}

function time(value: number): HtmlString {
  if (!value) return html`–`;
  return html`<u2-time datetime="${new Date(value * 1000).toISOString()}" second type=relative></u2-time>`;
}

function duration(seconds: number): string {
  const parts = [];
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    const value = Math.floor(seconds / size);
    if (value) parts.push(`${value}${unit}`);
    seconds %= size;
  }
  return parts.join(" ") || "0s";
}
