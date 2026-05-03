import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const online = await node.isOnline();
  const number = !online ? `<span class=-info>!</span>` : "";
  return `<span class=-title>${await node.app.t`Terminieren`}</span> ${number}`;
}
