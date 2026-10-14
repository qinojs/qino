import { html, sql, unixTime } from "@qino/qino";
import { fadeLimit, scores, strength } from "@qino/qino/score";
import * as u2 from "@qino/qino/u2";

import type { App, Db, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Score } from "@qino/qino/score";

const TOP = sql.raw("10");

type ScoreRow = { score: number; time: number; [key: string]: unknown };
type Stats = { total: number; faded: number; last: number };

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class="u2-card">
    <div class=-head>
      <span>${t`Scores`}</span>
      <button type=button data-prune u2-confirm="${t`Delete all faded scores now?`}">${t`Prune now`}</button>
      <button type=button data-refresh>${t`Refresh`}</button>
    </div>
    <div cms-part=list>${list(node)}</div>
  </div>`;
}

/** All rows of every score table. */
export async function total(db: Db): Promise<number> {
  let n = 0;
  for (const { table } of scores(db)) n += Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table)}`);
  return n;
}

export async function list(node: Node): Promise<HtmlString> {
  const { app } = node;
  const { db } = app;
  const now = unixTime();
  const all = scores(db);
  const cards = [];
  for (const score of all) cards.push(await renderScore(app, score, now));

  return html.async`<div class=-body>
    <b>${all.length}</b> ${app.t`score tables`} · ${total(db)} ${app.t`scored rows`}
  </div>
  ${cards}`;
}

/** One score table: its numbers, then the strongest rows. */
async function renderScore(app: App, { name, table, keys, half }: Score, now: number) {
  const db = app.db, t = sql.id(table);
  const limit = fadeLimit(db, name, now);
  const stats = await db.row<Stats>`
    SELECT COUNT(*) AS total, SUM(CASE WHEN score < ${limit} THEN 1 ELSE 0 END) AS faded, MAX(time) AS last FROM ${t}`;
  const top = await db.query<ScoreRow>`SELECT * FROM ${t} ORDER BY score DESC LIMIT ${TOP}`;
  const faded = Number(stats?.faded ?? 0);

  return html.async`<div class=-body>
    <code>${table}</code>
    · ${app.t`half-life`} ${duration(half)}
    · <b>${Number(stats?.total ?? 0)}</b> ${app.t`rows`}
    ${faded ? html.async` · <span class=u2-badge>${faded} ${app.t`faded`}</span>` : ""}
    · ${app.t`last access`} ${u2.el.time(stats?.last, { second: true })}
  </div>
  ${top.length ? renderTop(app, name, keys, top, now) : html.async`<div class=-body>${app.t`No accesses recorded yet.`}</div>`}`;
}

function renderTop(app: App, name: string, keys: string[], top: ScoreRow[], now: number) {
  const rows = top.map((row, i) =>
    html`<tr>
      <td>${i + 1}
      <td><code>${keys.map((key) => `${key} ${row[key]}`).join(", ")}</code>
      <td><code>${Number(row.score).toFixed(3)}</code>
      <td>${accesses(strength(app.db, name, Number(row.score), now))}
      <td>${u2.el.time(row.time, { second: true })}`
  );
  return html.async`<table class="u2-table -Sticky">
    <thead><tr>
      <th>#
      <th>${app.t`Key`} <small>${app.t`db`}</small>
      <th><code>score</code> <small>${app.t`db`}</small>
      <th>${app.t`Strength`} <small>${app.t`computed`}</small>
      <th><code>time</code> <small>${app.t`db`}</small>
    <tbody>${rows}
  </table>`;
}

/** Strength in accesses: fractions matter near the fade limit, whole numbers above it. */
function accesses(value: number) {
  return value < 10 ? value.toFixed(2) : String(Math.round(value));
}

function duration(seconds: number) {
  const parts = [];
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    const value = Math.floor(seconds / size);
    if (value) parts.push(`${value}${unit}`);
    seconds %= size;
  }
  return parts.join(" ") || "0s";
}
