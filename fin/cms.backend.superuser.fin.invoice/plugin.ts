import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { amounts, finTexts, inFin } from "@qino/qino/cms.backend.superuser.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Invoices", de: "Rechnungen" });
}

/** What customers still owe, and how much of it is late. */
async function widget(app: App): Promise<HtmlString> {
  const today = new Date().toLocaleDateString("sv-SE");
  const [open, overdue] = await Promise.all([
    // a credit note still open is owed by us: it takes off what is claimed, and is never overdue
    app.db.query`SELECT currency, SUM(CASE WHEN type = 'credit_note' THEN paid - total ELSE total - paid END) AS amount
      FROM invoice WHERE direction = 'out' AND status = 'open' GROUP BY currency ORDER BY currency`,
    app.db.one`SELECT COUNT(*) FROM invoice
      WHERE direction = 'out' AND type = 'invoice' AND status = 'open' AND due < ${today}`.then(Number),
  ]);
  return html.async`<div>
    ${amounts(open)} <small>${app.t`receivable`}</small><br>
    <b>${overdue}</b> ${app.t`overdue`}
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App): Promise<HtmlString> => finTexts(app, () => widget(app));
