/**
 * cms.backend.settings/mod.ts
 * Port of cms.backend.settings/index.php
 */

import { addSettingsEditor, settingsSourceAttr } from "../core/lib/settings.ts";
import { backend } from "../cms.backend/mod.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import { hee } from "../core/lib/util.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.settings";
export const needs = ["cms.backend"];

/**
 * cms.backend.settings install()
 * Port of cms.backend.settings/install.php
 */
export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.settings");
  if (P) {
    await P.title("en", "Settings");
  }
}

function render(_node: unknown, { ctx }: { ctx: RequestContext }): string {
  addSettingsEditor(ctx);
  const source = settingsSourceAttr({ kind: "app" });
  return `<div class=u2-card>
	<div class=-head>Settings</div>
	<div class=-body>
		<settings-editor source="${source}"></settings-editor>
	</div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const db = app.db;
  const count = Number(await db.one("SELECT count(*) FROM qg_setting"));
  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>Entries:<td>${hee(String(count))}
</table>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
