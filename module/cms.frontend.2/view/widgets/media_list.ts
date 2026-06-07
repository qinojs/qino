import { getCtx } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node): Promise<string> {
  const ctx = getCtx();
  const files = await node.filesAndPlaceholders();
  if (!Object.keys(files).length) {
    return node.app.t`No files available`;
  }
  const { default: trs } = await import("./media_list_trs.ts");
  const trsHtml = await trs(node);
  const fileCount = Object.keys(await node.files()).length;

  const zipLink = fileCount ? `<div style="text-align:right;">${fileCount} Files | <a target=_blank href="${ctx.appURL}?qgCms_page_files_as_zip=${node}">Download ZIP</a></div>` : "";

  return `<table class="-cmsFileList -styled"><tbody cmsconf=media_list_trs u2-dropzone>${trsHtml}</table>${zipLink}`;
}
