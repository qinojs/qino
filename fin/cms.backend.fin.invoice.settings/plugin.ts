import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { inFin } from "@qino/qino/cms.backend.fin";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Settings", de: "Einstellungen" });
}

export const uninstall = ({ app }: { app: App }): Promise<void> => backend.uninstall(app, name);

/** The settings of `fin.invoice`, and the CSS its document is printed with. */
function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 40rem">
    <div class=-head>${t`Settings`}</div>
    <settings-editor source="/api/core/settings/fin.invoice"></settings-editor>
  </div>
  <form class=u2-card data-css style="flex:1 1 30rem">
    <div class=-head>${t`CSS of the document`}</div>
    <u2-code trim editable language=css><textarea name=css rows=16>${node.app.settings["fin.invoice"].css}</textarea></u2-code>
    <div><button>${t`Save`}</button></div>
  </form>
</div>`;
}

/** Node access is the permission — whoever may open this page may change the document's CSS. */
async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (vars.css == null) return null;
  await node.app.settings["fin.invoice"].css(String(vars.css));
  return { ok: true };
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render: inFin(render),
    api: inFin(api),
  },
};
