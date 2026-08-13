import { getCtx, html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  const ctx = getCtx();
  const files = await node.filesAndPlaceholders();
  if (!Object.keys(files).length) return node.app.t`No files available`;
  const { default: trs } = await import("./media_list_trs.ts");
  const trsHtml = await trs(node);
  const fileCount = Object.keys(await node.files()).length;

  const zipLink = fileCount ? html`<div style="text-align:right;">${fileCount} Files | <a target=_blank href="${ctx.req.appUrl}?cms_nodeFilesZip=${node.id}">Download ZIP</a></div>` : "";

  return html`<table class="-cmsFileList -styled"><tbody cmsconf=media_list_trs u2-dropzone>${trsHtml}</table>${zipLink}`;
}
