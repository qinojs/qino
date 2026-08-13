import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { scopes } from "@qino/qino/score";

import { list, render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Scores", de: "Scores" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const total = Number(await app.db.one`SELECT COUNT(*) FROM score`);
  return html`<div class=-body>
    <b>${scopes(app.db).size}</b> ${await app.t`scopes`} · ${total} ${await app.t`scored rows`}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { list },
  },
};
