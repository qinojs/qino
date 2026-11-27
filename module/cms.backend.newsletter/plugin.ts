import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { latestIssues, render } from "./render.ts";
import { setup, TYPE } from "./setup.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export { healthChecks } from "./healthChecks.ts";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Newsletter", de: "Newsletter" });
  await setup(app);
}

export async function backendDashboardWidget(app: App, page: Node): Promise<HtmlString> {
  const [lists, members, drafts] = await Promise.all([
    app.db.one`SELECT COUNT(*) FROM grp WHERE type = ${TYPE}`,
    app.db.one`SELECT COUNT(DISTINCT ug.usr_id) FROM usr_grp ug JOIN grp g ON g.id = ug.grp_id WHERE g.type = ${TYPE}`,
    app.db.one`SELECT COUNT(*) FROM message m JOIN grp g ON g.id = m.grp_id
      WHERE g.type = ${TYPE} AND NOT EXISTS (SELECT 1 FROM message_delivery d WHERE d.message_id = m.id)`,
  ]);
  return app.t.with(name, () => html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${app.t`Subscribers`}:<td>${Number(members)}
  <tr><td>${app.t`Lists`}:<td>${Number(lists)}
  <tr><td>${app.t`Drafts`}:<td>${Number(drafts)}
</table>
${latestIssues(page, 5)}
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
