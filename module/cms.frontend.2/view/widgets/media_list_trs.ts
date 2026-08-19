import { html, FileTransformer } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const files = await node.filesAndPlaceholders();
  const trs = [];
  for (const [name, F] of files) {
    const ext = F.extension;
    const exists = await F.exists();
    let preview: HtmlString | string = "";
    switch (ext) {
      case "jpg": case "jpeg": case "gif": case "png": case "svg": case "webp":
      case "pdf": {
        if (await FileTransformer.capabilities.magick) {
          const url = await F.url({w: 70, h: 40, max: true, page: 1});
          preview = html`<img src="${url}" ${ext === "svg" ? html.raw("height=40") : ""} alt="" draggable=true>`;
        }
        break;
      }
      case "mp4": case "webm": case "mov": case "avi": case "mkv": {
        if (await FileTransformer.capabilities.ffmpeg) {
          preview = html`<img src="${await F.url({w: 70, h: 40, fmt: "jpg", frame: 1})}" alt="" draggable=true>`;
        }
        break;
      }
      case "mp3": case "flac": case "ogg": case "aac": case "wav": case "m4a": {
        const url = await F.url();
        if (await FileTransformer.capabilities.ffmpeg) {
          preview = html`<img src="${await F.url({w: 70, h: 40, max: true})}" alt="" draggable=true
            onerror="this.replaceWith(Object.assign(document.createElement('audio'),{src:${JSON.stringify(url)},controls:true,draggable:true,style:'min-width:4.4rem;width:100%'}))">`;
        } else {
          preview = html`<audio src="${url}" controls style="min-width:4.375rem;width:100%" draggable=true>`;
        }
        break;
      }
      default: {
        const text = exists ? ext : "upload";
        preview = html`<svg width=70 height=40 style="display:block">
          <rect x=0 y=0 width=70 height=40 fill="var(--cms-color)"></rect>
          <text x=30 y=24 fill="#fff"><tspan text-anchor=middle>${text}</tspan></text>
        </svg>`;
      }
    }
    let linkHtml: HtmlString | string;
    if (!exists)
      linkHtml = await app.t`Placeholder`;
    else {
      const url = await F.url();
      linkHtml = html`<a title="${F.name}" href="${url}" target=_blank>${F.name}</a>`;
    }
    const nameLabel = name[0] !== "_" ? html`<div style="font-size:11px;color:#999;font-style:italic">(${name})</div>` : "";
    const size = exists ? await F.size() : 0;
    const sizeStr = size ? String(Math.round(size / 1024)) + " KB" : "";

    trs.push(html`<tr itemid="${name}" draggable>
      <td class=-preview title="${await app.t`Click to replace the file`}">${preview}
      <td class=-link>${linkHtml}${nameLabel}
      <td class=-size>${sizeStr}
      <td class=-handle u2-draghandle>
      <td class=-delete>`);
  }
  return html.join(trs);
}
