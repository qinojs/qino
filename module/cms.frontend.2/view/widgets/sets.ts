import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  // SettingsEditor.mjs is loaded by panel.mjs
  return html`<settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>`;
}
