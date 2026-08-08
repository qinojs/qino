import { html, unixTime, type App, type HtmlString } from "../core/mod.ts";
import { backend, u2 } from "../cms.backend/mod.ts";
import { chats as chatList } from "../messaging.telegram/mod.ts";
import { bot, chats, render, send } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.messaging.telegram";
export const description = "Lists linked Telegram chats and sends messages to them.";
export const needs = ["cms.backend.superuser.messaging", "messaging.telegram"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Telegram", de: "Telegram" });
  await app.db.table("module").delete("cms.backend.superuser.telegram");
}

const RECENT = 7;

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const week = unixTime() - RECENT * 86400;
  const [totals, recent, labels] = await Promise.all([
    app.db.row`SELECT COUNT(*) AS n,
        SUM(CASE WHEN created > ${week} THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failing
      FROM telegram_chat`.catch(() => undefined),
    chatList(app, RECENT),
    Promise.all([app.t`chats`, app.t`new in ${RECENT} days`, app.t`failing`]),
  ]);
  const [chatsLabel, freshLabel, failingLabel] = labels;
  const fresh = Number(totals?.fresh ?? 0);
  const failing = Number(totals?.failing ?? 0);

  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${chatsLabel}
    ${fresh ? html` · <span class=u2-badge>+${fresh} ${freshLabel}</span>` : ""}
    ${failing ? html` · <span class=u2-badge>${failing} ${failingLabel}</span>` : ""}
    ${recent.length ? html`<table class=u2-table>${html.join(recent.map((c) => html`<tr>
      <td>${c.email ?? "#" + c.usr_id}
      <td>${c.username ? "@" + c.username : ""}
      <td>${u2.time(c.created)}`))}</table>` : ""}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { bot, send, chats },
  },
};
