import { toFileUrl } from "@std/path";
import { fs, getCtx, html } from "@qino/qino";
import { editorUrl } from "@qino/qino/fileEditor";

import { codeFiles } from "./codeFiles.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Examples are commented out. Only the type is imported (removed at load), so the file uses the
// app's own qino.
const initialSrc = (id: number) =>
  `import type { NodeRender } from "jsr:@qino/qino/cms.cont.ts";

/** Renders this content node. Returns an HtmlString or a string. */
const render = async (node, { html }) => {
  // const title = node.cms.text(node, "title", { tag: "h2" });   // editable text
  // const image = await node.file("image1");                     // file of this node
  // const body  = await node.cont("body", "cms.cont.text");      // embedded content node
  // const page  = await node.page();                             // enclosing page
  return html.async\`<div>
    Node ${id}
  </div>\`;
};

export default render;
`;

async function render(node: Node, opt: { ctx: Ctx; vars: Record<string, unknown> }): Promise<string> {
  const code = codeFiles(node);
  if (await node.edit()) await code.create(initialSrc(node.id));
  await code.addAssets();

  // mtime busts the ESM cache, so a saved file takes effect with the next request
  const mtime = await fs.mtime(code.src);
  if (mtime === undefined) return "<div></div>";
  const mod = await import(`${toFileUrl(code.src).href}?v=${mtime}`);
  if (typeof mod.default !== "function") throw new Error(`${node.id}.ts has no default exported function`);
  return String(await mod.default(node, { ...opt, html }) ?? "");
}

/** The node's files for the panel. `.ts` runs on the server, so only superusers get it — each url
  * allows editing for this session. */
const api = (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getFileEditorLinks" || !getCtx().user?.superuser) return [];
  const files = codeFiles(node);
  return (["src", "css", "js"] as const)
    .map((key) => ({ name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url);
};

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    api,
  },
};
