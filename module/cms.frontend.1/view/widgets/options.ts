import type { Node } from "../../../cms/lib/Node.ts";
// deno-lint-ignore-file no-explicit-any

export default async function (node: Node, _vars: any = {}): Promise<string> {
  try {
    const mod = node.mod;
    const options = mod?.cms?.node?.options;
    if (typeof options === "function") {
      const result = await options(node, _vars);
      if (result !== false) return result ?? "";
    }
  } catch { /* kein options export */ }
  // Fallback: generischer Settings-Editor für page.settings
  const ctx = (await import("qg")).getCtx();
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
