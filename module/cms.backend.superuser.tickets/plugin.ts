import { html, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Tickets", de: "Tickets" });
}

// the ticket module keeps no reading API — one consumer, so the queries live here
const LIMIT = 200;

export async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const now = unixTime();
  const rows = await node.app.db.query`SELECT * FROM ticket ORDER BY created DESC LIMIT ${LIMIT}`;
  const [never, del, ...states] = await Promise.all([t`never`, t`Revoke this ticket?`, t`open`, t`redeemed`, t`expired`]);
  // 0 open, 1 redeemed, 2 expired — an index, so two labels translating alike cannot collide
  const state = (row: Row) => Number(row.used) >= Number(row.uses) ? 1
    : row.expires != null && Number(row.expires) < now ? 2
    : 0;
  const open = rows.filter((row) => !state(row));
  const byPurpose = new Map<string, number>();
  for (const row of open) byPurpose.set(String(row.purpose), (byPurpose.get(String(row.purpose)) ?? 0) + 1);

  return html.async`<div class=u2-flex>
  <div class=u2-card cms-part=tickets>
    <div class=-head>${t`Tickets`} (${open.length} ${states[0]})</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Purpose`}
        <th>${t`State`}
        <th>${t`Payload`}
        <th>${t`Issued`}
        <th>${t`Expires`}
        <th>
      <tbody>${rows.length
        ? rows.map((row) => html`<tr>
          <td>${row.purpose}
          <td><span class=u2-badge>${states[state(row)]}</span>
          <td><small>${String(row.data ?? "").slice(0, 120)}</small>
          <td>${u2.el.time(row.created)}
          <td>${row.expires == null ? never : u2.el.time(row.expires)}
          <td>${state(row) ? ""
            : html`<button type=button class=u2-unstyle data-revoke="${row.hash}"
              u2-confirm="${del}"><u2-ico icon=delete>✕</u2-ico></button>`}`)
        : html`<tr><td colspan=6>${await t`No tickets yet.`}`}
    </table>
    <div>
      <small>${t`A ticket cannot be opened from here — only its holder knows the handle, the database keeps a hash of it. Spent and expired ones stay for a year as a record.`}</small>
    </div>
  </div>

  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`Open by kind`}</div>
    <div>
      ${byPurpose.size
        ? Array.from(byPurpose, ([purpose, n]) => html`<div>${purpose}: <b>${n}</b></div>`)
        : html`<div>${await t`None`}</div>`}
    </div>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const open = await app.db.one`SELECT COUNT(*) FROM ticket
    WHERE used < uses AND (expires IS NULL OR expires >= ${unixTime()})`.catch(() => 0);
  return html.async`<div class=-body>
    <b>${Number(open)}</b> ${app.t`outstanding tickets`}
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
