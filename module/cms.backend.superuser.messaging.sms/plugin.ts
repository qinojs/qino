import { html, typeContacts, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { pendingContacts } from "@qino/qino/messaging";

import { phones, provider, render, send } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "SMS", de: "SMS" });
}

const RECENT = 7; // days the counter looks back
const SHOWN = 7; // rows of the newest numbers

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const week = unixTime() - RECENT * 86400;
  const [totals, claims, recent, labels] = await Promise.all([
    app.db.row`SELECT COUNT(*) AS n,
        SUM(CASE WHEN created > ${week} THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failing
      FROM usr_contact WHERE type = ${"phone"}`.catch(() => undefined),
    pendingContacts(app, "phone").catch(() => []),
    typeContacts(app.db, "phone", SHOWN),
    Promise.all([app.t`phone numbers`, app.t`pending`, app.t`new in ${RECENT} days`, app.t`failing`]),
  ]);
  const [phonesLabel, pendingLabel, freshLabel, failingLabel] = labels;
  const pending = claims.length;
  const fresh = Number(totals?.fresh ?? 0);
  const failing = Number(totals?.failing ?? 0);

  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${phonesLabel}
    ${pending ? html` · <span class=u2-badge>${pending} ${pendingLabel}</span>` : ""}
    ${fresh ? html` · <span class=u2-badge>+${fresh} ${freshLabel}</span>` : ""}
    ${failing ? html` · <span class=u2-badge>${failing} ${failingLabel}</span>` : ""}
    ${recent.length ? html`<table class=u2-table>${recent.map((p) => html`<tr>
      <td>${p.email ?? "#" + p.usr_id}
      <td>${p.address}
      <td>${u2.el.time(p.created)}`)}</table>` : ""}
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
