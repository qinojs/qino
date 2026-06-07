import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, _vars: unknown = {}): Promise<string> {
  try {
    const options = node.module?.plugin?.cms?.node?.options;
    if (typeof options === "function") {
      const result = await options(node, _vars);
      if (result !== false) return result ?? "";
    }
  } catch { /* no options export */ }
  // Fallback: generic settings editor for page.settings (SettingsEditor.mjs is loaded by panel.mjs)
  return `
    <div>
      <settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>
    </div>`;
}
