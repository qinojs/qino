import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin, money, WIDGET_ROWS, widgetList } from "@qino/qino/cms.backend.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin.bank", name);
  await backend.install(app, name, { en: "Bank", de: "Bank" });
}

/** Lines nobody has claimed yet — what needs a hand —, the latest first. */
async function widget(app: App, page: Node): Promise<HtmlString> {
  const t = app.t;
  const [accounts, open, rows, pageUrl] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM bank_account`.then(Number),
    app.db.one`SELECT COUNT(*) FROM bank_tx WHERE payment_id IS NULL`.then(Number),
    app.db.query`SELECT * FROM bank_tx WHERE payment_id IS NULL ORDER BY date DESC, id DESC LIMIT ${WIDGET_ROWS}`,
    page.url(),
  ]);
  return html.async`<div>
    <b>${open}</b> ${t`lines unassigned`}<br>
    <small>${accounts} ${t`accounts`}</small>
  </div>
  ${widgetList(rows.map((row) => html.async`<tr u2-href>
    <td><a href="${backend.toUrl(pageUrl, { id: row.id })}">${row.date}</a>
    <td>${row.party_name || row.reference}
    <td style="text-align:end">${money(row.amount, row.currency)}`))}`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App, page: Node): Promise<HtmlString> => finTexts(app, () => widget(app, page));
