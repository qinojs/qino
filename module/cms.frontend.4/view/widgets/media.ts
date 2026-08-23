import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const { default: mediaList } = await import("./media_list.ts");
  const mediaListHtml = await mediaList(node);
  const sortSelect = (await node.filesAndPlaceholders()).size > 1 ? html.async`
    <select class=-sortFilesSelect>
      <option value> ${t`sort by...`}
      <option value=name>${t`Name`}
      <option value=name_reverse>${t`Name reversed`}
      <option value=date>${t`Date`}
      <option value=reverse>${t`reverse`}
    </select>
    <select class=-deleteFilesSelect>
      <option> ${t`delete...`}
      <option value=double>${t`duplicates`}
      <option value=all>${t`all`}
    </select>` : "";

  return html.async`<div cmsconf=contMedia_overview class=file-manager pid=${node.id}>
  <button class=-uploadBtn>${t`upload`}</button>
  <input class=-addExistingFile type=qgcms-file placeholder="${t`existing file`}">
  ${sortSelect}
  <br><br>
  <div cmsconf=media_list id=cmsWidgetContent_media_list>
    ${mediaListHtml}
  </div>
</div>`;
}
