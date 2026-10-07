import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { amounts } from "@qino/qino/cms.backend.superuser.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Invoices", de: "Rechnungen" });
}

/** What customers still owe, and how much of it is late. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const today = new Date().toLocaleDateString("sv-SE");
  const [open, overdue] = await Promise.all([
    app.db.query`SELECT currency, SUM(total - paid) AS amount FROM invoice
      WHERE direction = 'out' AND status = 'open' GROUP BY currency ORDER BY currency`,
    app.db.one`SELECT COUNT(*) FROM invoice
      WHERE direction = 'out' AND status = 'open' AND due < ${today}`.then(Number),
  ]);
  return html.async`<div>
    ${amounts(open)} <small>${app.t`receivable`}</small><br>
    <b>${overdue}</b> ${app.t`overdue`}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
