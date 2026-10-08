import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin, money } from "@qino/qino/cms.backend.superuser.fin";
import { balances } from "@qino/qino/fin.accounting";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Accounting", de: "Buchhaltung" });
}

/** This year's result so far. */
async function widget(app: App): Promise<HtmlString> {
  const year = new Date().getFullYear();
  const rows = await balances(app, { from: `${year}-01-01`, to: `${year}-12-31` });
  const booked = rows.filter((r) => r.type === "income" || r.type === "expense");
  const result = -booked.reduce((sum, r) => sum + Number(r.balance), 0);
  const currency = String(await app.settings["fin.accounting"].currency ?? "");
  return html.async`<div>
    <b>${currency ? money(result, currency) : "—"}</b> ${result >= 0 ? app.t`profit` : app.t`loss`} ${year}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App): Promise<HtmlString> => finTexts(app, () => widget(app));
