import { html, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { amounts, direction, finTexts, inFin, money, status, WIDGET_ROWS, widgetList } from "@qino/qino/cms.backend.fin";
import * as u2 from "@qino/qino/u2";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin.payment", name);
  await backend.install(app, name, { en: "Payments", de: "Zahlungen" });
}

/** What came in during the last 30 days and what is still waiting; then the payments, the waiting
 *  ones first, the latest change next. */
async function widget(app: App, page: Node): Promise<HtmlString> {
  const t = app.t;
  const month = unixTime() - 30 * 86400;
  const [moved, waiting, rows, pageUrl] = await Promise.all([
    app.db.query`SELECT currency, SUM(paid - refunded) AS amount FROM payment
      WHERE direction = 'in' AND changed > ${month} AND paid > 0 GROUP BY currency ORDER BY currency`,
    app.db.one`SELECT COUNT(*) FROM payment WHERE status IN ('pending', 'processing')`.then(Number),
    app.db.query`SELECT * FROM payment
      ORDER BY CASE WHEN status IN ('pending', 'processing') THEN 0 ELSE 1 END, changed DESC, id DESC
      LIMIT ${WIDGET_ROWS}`,
    page.url(),
  ]);
  return html.async`<div>
    ${amounts(moved)} <small>${t`in, 30 days`}</small><br>
    <b>${waiting}</b> ${t`waiting`}
  </div>
  ${widgetList(rows.map((row) => html.async`<tr u2-href>
    <td><a href="${backend.toUrl(pageUrl, { id: row.id })}">#${row.id}</a>
    <td>${u2.el.time(row.changed, { narrow: true })}
    <td>${direction(row.direction, row.direction === "in" ? t`in` : t`out`)}
    <td>${row.provider}${row.method ? html`<small>.${row.method}</small>` : ""}
    <td style="text-align:end">${money(row.amount, row.currency)}
    <td>${status(app, row.status)}`))}`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App, page: Node): Promise<HtmlString> => finTexts(app, () => widget(app, page));
