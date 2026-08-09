import type { Node } from "../cms/mod.ts";
import { renderTemplateFile } from "../cms.templateParser/mod.ts";
import { codeFiles } from "./codeFiles.ts";
import { nodeApi } from "./api.ts";
import options from "./options.ts";

export const name = "cms.cont.html";
export const description = "Per-node HTML files with CMS syntax and HTML/CSS/JavaScript boilerplate.";
export const needs = ["cms", "cms.templateParser"];
export const api = nodeApi(name);

// Commented out on purpose: the parser strips comments, so nothing is created before you want it.
const INITIAL_SRC = `<div>

  <!-- editable text — the tag becomes the wrapper, the inner html is the initial content
  <h2 cms-text=title>Title</h2>
  <div cms-text=main></div>
  <p cms-text=note if></p>          hidden for visitors while empty
  -->

  <!-- editable image — width/height in px, "localized" gives every language its own
  <cms-image name=image1 width=110 height=110 fit=contain />
  <cms-image name=logo width=110 height=110 localized />
  -->

  <!-- embedded content node, created on first render
  <cms-cont name=body module=cms.cont.text />
  -->

  <!-- node= targets another node: page, layout, parent, parent(2) or an id
  <h1 cms-text=title node=page></h1>
  <cms-cont name=nav node=layout />
  -->

</div>
`;

async function render(node: Node): Promise<string> {
  const code = codeFiles(node);
  if (node.edit) await code.create(INITIAL_SRC);
  await code.addAssets();
  return await renderTemplateFile(code.src, node) ?? "<div></div>";
}

export const cms = {
  node: {
    render,
    options,
  },
};
