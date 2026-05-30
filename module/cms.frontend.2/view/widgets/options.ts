import type { Node } from "../../../cms/lib/Node.ts";
import { getCtx } from "../../../core/lib/RequestContext.ts";

export default async function (node: Node, _vars: unknown = {}): Promise<string> {
  try {
    const options = node.module?.exports?.cms?.node?.options;
    if (typeof options === "function") {
      const result = await options(node, _vars);
      if (result !== false) return result ?? "";
    }
  } catch { /* no options export */ }
  // Fallback: generic settings editor for page.settings
  const ctx = getCtx();
  const { addSettingsEditor, settingsSourceAttr } = await import("../../../core/lib/settings.ts");
  addSettingsEditor(ctx);
  const pageSettingsSource = settingsSourceAttr({
    kind: "node",
    id: node.id,
  });
  return `
    <div>
      <settings-editor source="${pageSettingsSource}" pid="${node.id}"></settings-editor>
    </div>`;
}
