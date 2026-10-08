import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { subscriptions } from "@qino/qino/fin.subscription";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Subscriptions", de: "Abos" });
}

/** What the next billing run takes: subscriptions renewing within the lead time. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const lead = Number(await app.settings["fin.subscription"].lead ?? 30);
  const horizon = new Date(Date.now() + lead * 86400_000).toISOString().slice(0, 10);
  const due = (await subscriptions(app)).filter((s) =>
    String(s.next) <= horizon && (!s.end_date || String(s.next) < String(s.end_date).slice(0, 10)));
  return html.async`<div><b>${due.length}</b> ${app.t`subscriptions to bill within`} ${lead} ${app.t`days`}</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
