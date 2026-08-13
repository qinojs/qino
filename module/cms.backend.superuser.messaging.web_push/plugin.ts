import { html, unixTime, type App, type HtmlString } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { subscriptions as subscriptionList } from "@qino/qino/messaging.web_push";
import { channels, render, send, subscriptions } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Web Push", de: "Web Push" });
  await app.db.table("module").delete("cms.backend.superuser.web_push");
}

const RECENT = 7;

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const week = unixTime() - RECENT * 86400;
  const [totals, recent, labels] = await Promise.all([
    app.db.row`SELECT COUNT(*) AS n,
        SUM(CASE WHEN usr_id IS NULL THEN 1 ELSE 0 END) AS anon,
        SUM(CASE WHEN created > ${week} THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failing,
        (SELECT COUNT(*) FROM web_push_channel) AS channels
      FROM web_push_subscription`.catch(() => undefined),
    subscriptionList(app, RECENT),
    Promise.all([app.t`subscriptions`, app.t`anonymous`, app.t`channels`, app.t`new in ${RECENT} days`, app.t`failing`]),
  ]);
  const [subsLabel, anonLabel, channelsLabel, freshLabel, failingLabel] = labels;
  const fresh = Number(totals?.fresh ?? 0);
  const failing = Number(totals?.failing ?? 0);

  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${subsLabel}
    ${Number(totals?.anon ?? 0) ? html`<small>(${totals!.anon} ${anonLabel})</small>` : ""}<br>
    <b>${Number(totals?.channels ?? 0)}</b> ${channelsLabel}
    ${fresh ? html` · <span class=u2-badge>+${fresh} ${freshLabel}</span>` : ""}
    ${failing ? html` · <span class=u2-badge>${failing} ${failingLabel}</span>` : ""}
    ${recent.length ? html`<table class=u2-table>${recent.map((s) => html`<tr>
      <td>${s.email ?? (s.usr_id ? "#" + s.usr_id : anonLabel)}
      <td>${(s.channels as string[]).join(", ")}
      <td>${u2.el.time(s.created)}`)}</table>` : ""}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { channels, send, subscriptions },
  },
};
