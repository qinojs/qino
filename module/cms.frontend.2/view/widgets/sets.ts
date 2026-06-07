import type { Node } from "../../../cms/mod.ts";
export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  // SettingsEditor.mjs is loaded by panel.mjs
  return `<settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>`;
}
