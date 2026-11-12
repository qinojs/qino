import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { render, TYPE } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Newsletter", de: "Newsletter" });
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const [lists, members, drafts] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM grp WHERE type = ${TYPE}`,
    app.db.one`SELECT COUNT(DISTINCT ug.usr_id) FROM usr_grp ug JOIN grp g ON g.id = ug.grp_id WHERE g.type = ${TYPE}`,
    app.db.one`SELECT COUNT(*) FROM message m JOIN grp g ON g.id = m.grp_id
      WHERE g.type = ${TYPE} AND NOT EXISTS (SELECT 1 FROM message_delivery d WHERE d.message_id = m.id)`,
  ]);
  return app.t.with(name, () => html.async`<div class=-body>
    <b>${Number(members)}</b> ${app.t`subscribers`} · ${Number(lists)} ${app.t`lists`} · ${Number(drafts)} ${app.t`drafts`}
  </div>`);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    api,
  },
};
