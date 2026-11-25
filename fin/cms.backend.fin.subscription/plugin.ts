import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin, money, WIDGET_ROWS, widgetList } from "@qino/qino/cms.backend.fin";
import { horizon, renews, subscriptions } from "@qino/qino/fin.subscription";

import { render, userSubscriptions } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.fin.subscription", name);
  await backend.install(app, name, { en: "Subscriptions", de: "Abos" });
}

/** What the next billing run takes: subscriptions renewing within the lead time, the soonest first. */
async function widget(app: App, page: Node): Promise<HtmlString> {
  const t = app.t;
  const [lead, until, all, pageUrl] = await Promise.all([
    app.settings["fin.subscription"].lead,
    horizon(app),
    subscriptions(app),
    page.url(),
  ]);
  const due = all.filter((s) => renews(s, until)).sort((a, b) => String(a.next).localeCompare(String(b.next)));
  return html.async`<div><b>${due.length}</b> ${t`subscriptions to bill within`} ${Number(lead ?? 30)} ${t`days`}</div>
  ${widgetList(due.slice(0, WIDGET_ROWS).map((s) => html.async`<tr u2-href>
    <td>${s.next}
    <td><a href="${backend.toUrl(pageUrl, { id: s.id })}">${s.label}</a> ${s.detail ? html`<small>${s.detail}</small>` : ""}
    <td style="text-align:end">${money(s.amount, s.currencyCode)}`))}`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App, page: Node): Promise<HtmlString> => finTexts(app, () => widget(app, page));

export const backendRowWidget = {
  usr: (app: App, id: unknown, page: Node): Promise<HtmlString | string> => finTexts(app, () => userSubscriptions(app, id, page)),
};
