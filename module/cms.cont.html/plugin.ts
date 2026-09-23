import { renderTemplateFile } from "@qino/qino/cms.templateParser";

import { editorUrl } from "@qino/qino/fileEditor";

import { codeFiles } from "./codeFiles.ts";
import { nodeApi } from "./api.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const api = nodeApi(name);

async function render(node: Node): Promise<string> {
  const code = codeFiles(node);
  if (await node.edit()) await code.create();
  await code.addAssets();
  return await renderTemplateFile(code.src, node) ?? "<div></div>";
}

/** The node's files for the panel, for editors. Each url allows editing for this session. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getFileEditorLinks" || await node.access() < 2) return [];
  const files = codeFiles(node);
  await files.create();
  return (["src", "css", "js"] as const)
    .map((key) => ({ key: key === "src" ? "html" : key, name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url);
};

export const cms = {
  node: {
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
