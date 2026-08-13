import type { Node } from "@qino/qino/cms";
import { html, type HtmlString } from "@qino/qino";
import { editorUrl } from "@qino/qino/fileEditor";
import { codeFiles } from "./codeFiles.ts";

export default async function (node: Node): Promise<HtmlString | false> {
  if (await node.access() < 2) return false;
  const code = codeFiles(node);
  const src = editorUrl(code.src);
  if (!src) return false; // no editor module, nothing to offer
  const t = node.app.t;
  return html.async`
    <div>
      <p>${t`Edit the files of this content:`}</p>
      <a target=_blank href="${src}">${node.id}.html</a><br>
      <a target=_blank href="${editorUrl(code.css)}">${node.id}.css</a><br>
      <a target=_blank href="${editorUrl(code.js)}">${node.id}.js</a>
    </div>`;
}
