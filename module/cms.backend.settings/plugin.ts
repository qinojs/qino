import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import type { Ctx, App, HtmlString } from "@qino/qino";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.settings", { en: "Settings", de: "Einstellungen" });
}

function render(_node: unknown, { ctx }: { ctx: Ctx }): HtmlString {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "core/pub/js/SettingsEditor.mjs");
  return html`<div class=u2-card>
  <div class=-head>Settings</div>
  <div>
    <settings-editor source="/api/core/settings"></settings-editor>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const count = Number(await app.db.one`SELECT count(*) FROM qg_setting`);
  return html`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>Entries:<td>${count}
</table>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
