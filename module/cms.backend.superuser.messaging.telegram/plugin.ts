import { html, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { chats as chatList } from "@qino/qino/messaging.telegram";

import { bot, chats, render, send } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

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
    ${recent.length ? html`<table class=u2-table>${recent.map((c) => html`<tr>
      <td>${c.email ?? "#" + c.usr_id}
      <td>${c.username ? "@" + c.username : ""}
      <td>${u2.el.time(c.created)}`)}</table>` : ""}
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
