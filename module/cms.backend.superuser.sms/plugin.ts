import { html, unixTime, type App, type HtmlString } from "../core/mod.ts";
import { backend, u2 } from "../cms.backend/mod.ts";
import { phones as phoneList } from "../messaging.sms/mod.ts";
import { phones, provider, render, send } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.sms";
export const description = "Configures SMS delivery, manages phone verification and sends messages.";
export const needs = ["cms.backend", "messaging.sms"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "SMS", de: "SMS" });
}

const RECENT = 7;

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const week = unixTime() - RECENT * 86400;
  const [totals, recent, labels] = await Promise.all([
    app.db.row`SELECT COUNT(*) AS n,
        SUM(CASE WHEN verified IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN created > ${week} THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failing
      FROM usr_phone`.catch(() => undefined),
    phoneList(app, RECENT),
    Promise.all([app.t`phone numbers`, app.t`pending`, app.t`new in ${RECENT} days`, app.t`failing`]),
  ]);
  const [phonesLabel, pendingLabel, freshLabel, failingLabel] = labels;
  const pending = Number(totals?.pending ?? 0);
  const fresh = Number(totals?.fresh ?? 0);
  const failing = Number(totals?.failing ?? 0);

  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${phonesLabel}
    ${pending ? html` · <span class=u2-badge>${pending} ${pendingLabel}</span>` : ""}
    ${fresh ? html` · <span class=u2-badge>+${fresh} ${freshLabel}</span>` : ""}
    ${failing ? html` · <span class=u2-badge>${failing} ${failingLabel}</span>` : ""}
    ${recent.length ? html`<table class=u2-table>${html.join(recent.map((p) => html`<tr>
      <td>${p.email ?? "#" + p.usr_id}
      <td>${p.number}
      <td>${p.verified ? u2.time(p.verified) : pendingLabel}`))}</table>` : ""}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { provider, send, phones },
  },
};
