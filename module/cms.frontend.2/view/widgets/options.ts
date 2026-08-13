import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, _vars: unknown = {}): Promise<HtmlString | string> {
  try {
    const options = node.module?.plugin?.cms?.node?.options;
    if (typeof options === "function") {
      const result = await options(node, _vars);
      if (result !== false) return result ?? "";
    }
  } catch { /* no options export */ }
  // Fallback: generic settings editor for page.settings (SettingsEditor.mjs is loaded by panel.mjs)
  return html`
    <div>
      <settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>
    </div>`;
}
