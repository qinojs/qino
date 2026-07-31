import { html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { scopes } from "../score/mod.ts";
import { list, render } from "./render.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.score";
export const description = "Inspects and manages scored database records by scope.";
export const needs = ["cms.backend", "score"];

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
