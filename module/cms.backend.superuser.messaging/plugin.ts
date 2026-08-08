import { html, sql, tableRef, unixTime, type App, type HtmlString, type Row } from "../core/mod.ts";
import { backend, renderDashboard, u2 } from "../cms.backend/mod.ts";
import { messages } from "../messaging/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.messaging";
export const description = "Message journal with recipient-level delivery results.";
export const needs = ["cms.backend", "messaging"];

const RENAMES = {
  "cms.backend.superuser.sms": "cms.backend.superuser.messaging.sms",
  "cms.backend.superuser.telegram": "cms.backend.superuser.messaging.telegram",
  "cms.backend.superuser.web_push": "cms.backend.superuser.messaging.web_push",
};

export async function install({ app }: { app: App }): Promise<void> {
  const parent = await backend.install(app, name, { en: "Messaging", de: "Nachrichten" });
  if (!parent) return;
  const page = sql.id(tableRef("page"));
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    await app.db.exec`UPDATE ${page} SET module = ${newName}, basis = ${parent.id} WHERE module = ${oldName}`;
  }
}

export async function render(node: Node): Promise<HtmlString> {
  const [rows, labels] = await Promise.all([
    messages(node.app),
    Promise.all([node.app.t`recipients`, node.app.t`errors`, node.app.t`User`, node.app.t`Time`, node.app.t`Error`, node.app.t`anonymous`, node.app.t`group`]),
  ]);
  return html.async`<div class=u2-flex>
    <div class=u2-card>
      <div class=-head>${node.app.t`Messages`} (${rows.length})</div>
      ${rows.length ? html.join(rows.map((row) => message(row, labels))) : html`<div class=-body>${await node.app.t`No messages yet.`}</div>`}
    </div>
    ${renderDashboard(node)}
  </div>`;
}

function message(row: Row & { deliveries: Row[] }, labels: string[]): HtmlString {
  const [recipients, errorsLabel, user, time, error, anonymous, group] = labels;
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = row.grp_id ? `${row.grp_name ?? group} (#${row.grp_id})` : "";
  const data = readableData(row.data);
  return html`<details class=-body>
    <summary>
      <b>${row.direction === "out" ? "→" : "←"} ${row.channel}</b>
      · ${u2.time(row.time)}
      ${target ? html` · ${target}` : ""}
      · ${row.deliveries.length} ${recipients}
      ${errors ? html` · <span class=u2-badge>${errors} ${errorsLabel}</span>` : ""}
    </summary>
    <pre>${data}</pre>
    ${row.deliveries.length ? html`<table class=u2-table>
      <thead><tr>
        <th>${user}
        <th>${time}
        <th>${error}
      <tbody>${html.join(row.deliveries.map((delivery) => html`<tr>
        <td>${delivery.email ?? (delivery.usr_id ? "#" + delivery.usr_id : anonymous)}
        <td>${u2.time(delivery.time)}
        <td>${delivery.error ?? ""}`))}
    </table>` : ""}
  </details>`;
}

function readableData(data: unknown): string {
  try { return JSON.stringify(JSON.parse(String(data)), null, 2); } catch { return String(data ?? ""); }
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const since = unixTime() - 7 * 86400;
  const totals = await app.db.row`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN direction = ${"in"} THEN 1 ELSE 0 END) AS incoming,
      (SELECT COUNT(*) FROM message_delivery WHERE error IS NOT NULL AND time >= ${since}) AS errors
    FROM message WHERE time >= ${since}`.catch(() => undefined);
  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${app.t`messages in 7 days`}
    · ${Number(totals?.incoming ?? 0)} ${app.t`incoming`}
    ${Number(totals?.errors ?? 0) ? html` · <span class=u2-badge>${totals!.errors} ${await app.t`errors`}</span>` : ""}
  </div>`;
}

export const cms = { node: { render } };
