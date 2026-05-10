/**
 * cms.backend.settings/mod.ts
 * Port of cms.backend.settings/index.php
 */

import { addSettingsEditor, settingsSourceAttr } from "../core/lib/settings.ts";
import { backend } from "../cms.backend/mod.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

export const name = "cms.backend.settings";
export const needs = ["cms.backend"];

/**
 * cms.backend.settings install()
 * Port of cms.backend.settings/install.php
 */
export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.settings");
  if (P) {
    await P.title("en", "Settings");
    await P.title("de", "Einstellungen");
  }
}

function render(_node: any, { ctx }: { ctx: RequestContext }): string {
  addSettingsEditor(ctx);
  const source = settingsSourceAttr({ kind: "app" });
  return `<div class=c1-box>
	<div class=-head>Einstellungen</div>
	<div class=-body>
		<settings-editor source="${source}"></settings-editor>
	</div>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
