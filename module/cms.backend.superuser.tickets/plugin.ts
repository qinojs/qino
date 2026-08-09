import { html, unixTime, type App, type HtmlString } from "../core/mod.ts";
import { backend, u2 } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.tickets";
export const description = "Lists outstanding tickets — one-time links and the actions behind them.";
export const needs = ["cms.backend", "ticket"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Tickets", de: "Tickets" });
}

// the ticket module keeps no reading API — one consumer, so the queries live here
const outstanding = (app: App) =>
  app.db.query`SELECT * FROM ticket WHERE expires IS NULL OR expires >= ${unixTime()} ORDER BY created DESC`;

export async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const rows = await outstanding(node.app);
  const [expired, labels] = await Promise.all([
    node.app.db.one`SELECT COUNT(*) FROM ticket WHERE expires < ${unixTime()}`,
    Promise.all([t`never`, t`Revoke this ticket?`]),
  ]);
  const [never, del] = labels;
  const byPurpose = new Map<string, number>();
  for (const row of rows) byPurpose.set(String(row.purpose), (byPurpose.get(String(row.purpose)) ?? 0) + 1);

  return html.async`<div class=u2-flex>
  <div class=u2-card cms-part=tickets>
    <div class=-head>${t`Outstanding`} (${rows.length})</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Purpose`}
        <th>${t`Payload`}
        <th>${t`Issued`}
        <th>${t`Expires`}
        <th>${t`Uses`}
        <th>
      <tbody>${rows.length
        ? html.join(rows.map((row) => html`<tr>
          <td>${row.purpose}
          <td><small>${String(row.data ?? "").slice(0, 120)}</small>
          <td>${u2.time(row.created)}
          <td>${row.expires == null ? never : u2.time(row.expires)}
          <td>${row.uses}
          <td><button type=button class=u2-unstyle data-revoke="${row.hash}"
            u2-confirm="${del}"><u2-ico icon=delete>✕</u2-ico></button>`))
        : html`<tr><td colspan=6>${await t`No outstanding tickets.`}`}
    </table>
    <div class=-body>
      <small>${t`A ticket cannot be opened from here — only its holder knows the handle, the database keeps a hash of it.`}</small>
    </div>
  </div>

  <div class=u2-card style="flex-grow:0">
    <div class=-head>${t`Kinds`}</div>
    <div class=-body>
      ${byPurpose.size
        ? html.join([...byPurpose].map(([purpose, n]) => html`<div>${purpose}: <b>${n}</b></div>`))
        : html`<div>${await t`None`}</div>`}
    </div>
    <div class=-body>
      ${Number(expired)} ${t`expired`}
      <button type=button data-purge>${t`Delete expired`}</button>
    </div>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const open = await app.db.one`SELECT COUNT(*) FROM ticket WHERE expires IS NULL OR expires >= ${unixTime()}`.catch(() => 0);
  return html.async`<div class=-body>
    <b>${Number(open)}</b> ${app.t`outstanding tickets`}
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
