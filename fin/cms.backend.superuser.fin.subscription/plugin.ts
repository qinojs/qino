import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { finTexts, inFin } from "@qino/qino/cms.backend.superuser.fin";
import { horizon, renews, subscriptions } from "@qino/qino/fin.subscription";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Subscriptions", de: "Abos" });
}

/** What the next billing run takes: subscriptions renewing within the lead time. */
async function widget(app: App): Promise<HtmlString> {
  const lead = Number(await app.settings["fin.subscription"].lead ?? 30);
  const until = await horizon(app);
  const due = (await subscriptions(app)).filter((s) => renews(s, until));
  return html.async`<div><b>${due.length}</b> ${app.t`subscriptions to bill within`} ${lead} ${app.t`days`}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};

export const backendDashboardWidget = (app: App): Promise<HtmlString> => finTexts(app, () => widget(app));
