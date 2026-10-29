import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { scores } from "@qino/qino/score";

import { list, render, total } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.takeOver(app, "cms.backend.superuser.score", name); // the module this one replaces
  await backend.install(app, name, { en: "Scores", de: "Scores" });
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${scores(app.db).length}</b> ${app.t`score tables`} · ${total(app.db)} ${app.t`scored rows`}
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
