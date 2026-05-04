import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/lib/util.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const { default: mediaList } = await import("./media_list.ts");
  const mediaListHtml = await mediaList(node);
  const allFiles = await node.filesAndPlaceholders();
  //const fileCount = Object.keys(await node.files()).length;

  const sortSelect = Object.keys(allFiles).length > 1 ? `
    <select class=-sortFilesSelect>
      <option value> ${await app.t`sortieren nach...`}
      <option value=name>${await app.t`Name`}
      <option value=name_reverse>${await app.t`Name von hinten`}
      <option value=date>${await app.t`Datum`}
      <option value=reverse>${await app.t`umkehren`}
    </select>
    <select class=-deleteFilesSelect>
      <option> ${await app.t`löschen...`}
      <option value=double>${await app.t`doppelte`}
      <option value=all>${await app.t`alle`}
    </select>` : "";

  return `<div cmsconf=contMedia_overview class=qgCmsFileManager pid=${node}>
  <button class=-uploadBtn>${await app.t`hochladen`}</button>
  <input class=-addExistingFile type=qgcms-file placeholder="${hee(await app.t`bestehende Datei`)}">
  ${sortSelect}
  <br><br>
  <div cmsconf=media_list id=cmsWidgetContent_media_list>
    ${mediaListHtml}
  </div>
</div>`;
}
