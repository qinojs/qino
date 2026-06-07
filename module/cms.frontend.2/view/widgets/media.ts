import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/mod.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const { default: mediaList } = await import("./media_list.ts");
  const mediaListHtml = await mediaList(node);
  const allFiles = await node.filesAndPlaceholders();
  //const fileCount = Object.keys(await node.files()).length;

  const sortSelect = Object.keys(allFiles).length > 1 ? `
    <select class=-sortFilesSelect>
      <option value> ${await app.t`sort by...`}
      <option value=name>${await app.t`Name`}
      <option value=name_reverse>${await app.t`Name reversed`}
      <option value=date>${await app.t`Date`}
      <option value=reverse>${await app.t`reverse`}
    </select>
    <select class=-deleteFilesSelect>
      <option> ${await app.t`delete...`}
      <option value=double>${await app.t`duplicates`}
      <option value=all>${await app.t`all`}
    </select>` : "";

  return `<div cmsconf=contMedia_overview class=file-manager pid=${node}>
  <button class=-uploadBtn>${await app.t`upload`}</button>
  <input class=-addExistingFile type=qgcms-file placeholder="${hee(await app.t`existing file`)}">
  ${sortSelect}
  <br><br>
  <div cmsconf=media_list id=cmsWidgetContent_media_list>
    ${mediaListHtml}
  </div>
</div>`;
}
