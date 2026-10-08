import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin } from "@qino/qino/cms.backend.superuser.fin";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Inbox", de: "Eingang" });
}

/** How many read invoices wait to be checked. */
async function widget(app: App): Promise<HtmlString> {
  const waiting = Number(await app.db.one`SELECT COUNT(*) FROM invoice WHERE direction = 'in' AND status = 'draft'`);
  return html.async`<div><b>${waiting}</b> ${app.t`received invoices to check`}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App): Promise<HtmlString> => finTexts(app, () => widget(app));
