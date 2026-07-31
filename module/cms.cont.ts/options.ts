import type { Node } from "../cms/mod.ts";
import { getCtx, html, type HtmlString } from "../core/mod.ts";
import { editorUrl } from "../fileEditor/mod.ts";
import { codeFiles } from "./codeFiles.ts";

export default async function (node: Node): Promise<HtmlString | false> {
  if (!await getCtx().user?.get("superuser")) return false;
  const code = codeFiles(node);
  const t = node.app.t;
  return html.async`
    <div>
      <p>${t`Edit the files of this content:`}</p>
      <a target=_blank href="${editorUrl(code.src)}">${node.id}.ts</a><br>
      <a target=_blank href="${editorUrl(code.css)}">${node.id}.css</a><br>
      <a target=_blank href="${editorUrl(code.js)}">${node.id}.js</a>
    </div>`;
}
