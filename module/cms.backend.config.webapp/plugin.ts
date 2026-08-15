import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import { render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Web app", de: "Web-App" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const settings = app.settings.webapp;
  return html`<div style="padding:1rem">
  <strong>${await app.settings.identity.name || "—"}</strong>
  <div>${await settings.display}</div>
  <div>${app.appUrl}</div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
  },
};
