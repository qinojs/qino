import { renderTemplateFile } from "@qino/qino/cms.templateParser";

import { editorUrl } from "@qino/qino/fileEditor";

import { codeFiles } from "./codeFiles.ts";
import { nodeApi } from "./api.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const api = nodeApi(name);

// Commented out on purpose: the parser strips comments, so nothing is created before you want it.
const INITIAL_SRC = `<div><!-- 

  at render time the cms adds qcms-id=385 qcms-mod=cont.html to this root element; css and js target it

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

  <!-- node= targets another node: page, layout, direct parent, parent at absolute level 2 or an id
  <h1 cms-text=title node=page></h1>
  <cms-cont name=nav node=layout />
  -->

  <!-- stable internal link; an empty wrapper uses the target page title
  <a cms-link=page></a>
  <a cms-link=page cms-text=linkLabel>Read more</a>
  -->

</div>
`;

async function render(node: Node): Promise<string> {
  const code = codeFiles(node);
  if (await node.edit()) await code.create(INITIAL_SRC);
  await code.addAssets();
  return await renderTemplateFile(code.src, node) ?? "<div></div>";
}

/** What the panel asks for: the files of this node, for whoever may edit it. Each url is an
  * editing capability for this session. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getFileEditorLinks" || await node.access() < 2) return [];
  const files = codeFiles(node);
  return (["src", "css", "js"] as const)
    .map((key) => ({ name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url);
};

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
