import type { Node } from "../../../cms/lib/Node.ts";
import { addSettingsEditor, settingsSourceAttr } from "../../../core/lib/settings.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const ctx = (await import("qg")).getCtx();
  addSettingsEditor(ctx);
  const source = settingsSourceAttr({
    kind: "app",
    path: ["cms", "pages", String(node.id)],
  });
  return `<settings-editor source="${source}" pid="${node.id}"></settings-editor>`;
}
