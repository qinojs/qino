import { html, type HtmlString } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";
export default async function (node: Node): Promise<HtmlString | string> {
  if ((await node.access()) < 2) return "";
  // SettingsEditor.mjs is loaded by panel.mjs
  return html`<settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>`;
}
