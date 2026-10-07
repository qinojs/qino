import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Bank", de: "Bank" });
}

/** Lines nobody has claimed yet — what needs a hand. */
export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const [accounts, open] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM bank_account`.then(Number),
    app.db.one`SELECT COUNT(*) FROM bank_tx WHERE payment_id IS NULL`.then(Number),
  ]);
  return html.async`<div>
    <b>${open}</b> ${app.t`lines unassigned`}<br>
    <small>${accounts} ${app.t`accounts`}</small>
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
