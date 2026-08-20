import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { channels, templates } from "@qino/qino/messaging";

import { render } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Templates", de: "Vorlagen" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const rows = await templates(app).catch(() => []);
  const framed = channels(app).filter((c) => rows.some((row) => row.channel === c.name && row.main));

  return html.async`<div class=-body>
    <b>${rows.length}</b> ${app.t`templates`}
    · ${framed.length}/${channels(app).length} ${app.t`channels with a default`}
    ${framed.map((c) => html` <span class=u2-badge>${c.label}</span>`)}
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
  },
};
