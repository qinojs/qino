import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const hasDescr = (await (await node.text("_meta_description")).string())?.trim();
  const number = hasDescr ? "" : `<span class=-info>!</span>`;
  return `<span class=-title>${await node.app.t`SEO`}</span> ${number}`;
}
