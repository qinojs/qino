import type { Node } from "../../../cms/lib/Node.ts";
import { getCtx } from "../../../core/lib/context.ts";
import { addSettingsEditor, settingsSourceAttr } from "../../../core/lib/settings.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const ctx = getCtx();
  addSettingsEditor(ctx);
  const source = settingsSourceAttr({
    kind: "node",
    id: node.id,
  });
  return `<settings-editor source="${source}"></settings-editor>`;
}
