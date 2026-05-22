import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const count = Object.keys(await node.files()).length;
  const number = count ? `<span class=-info>${count}</span>` : "";
  return `<span class=-title>${await node.app.t`Files`}</span> ${number}`;
}
