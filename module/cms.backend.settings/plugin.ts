import { backend } from "../cms.backend/mod.ts";
import { hee, type Ctx, type App } from "../core/mod.ts";

export const name = "cms.backend.settings";
export const description = "Edits application settings through their merged schemas.";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.settings", { en: "Settings", de: "Einstellungen" });
}

function render(_node: unknown, { ctx }: { ctx: Ctx }): string {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "core/pub/js/SettingsEditor.mjs");
  return `<div class=u2-card>
  <div class=-head>Settings</div>
  <div class=-body>
    <settings-editor source="/api/core/settings"></settings-editor>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const count = Number(await app.db.one`SELECT count(*) FROM qg_setting`);
  return `<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>Entries:<td>${hee(count)}
</table>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
