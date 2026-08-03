import type { Node } from "../../../cms/mod.ts";
import { hee, html, type HtmlString, FileTransformer } from "../../../core/mod.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const files = await node.filesAndPlaceholders();
  let out = "";
  for (const [name, F] of Object.entries(files)) {
    const ext = F.extension;
    const exists = await F.exists();
    let preview = "";
    switch (ext) {
      case "jpg": case "jpeg": case "gif": case "png": case "svg": case "webp":
      case "pdf": {
        if (await FileTransformer.capabilities.magick) {
          const url = await F.url({w: 70, h: 40, dpt: 0, max: true, page:1});
          preview = `<img src="${url}" ${ext === "svg" ? "height=40" : ""} alt="" draggable=true>`;
        }
        break;
      }
      case "mp4": case "webm": case "mov": case "avi": case "mkv": {
        if (await FileTransformer.capabilities.ffmpeg) {
          const url = await F.url();
          const fname = hee(F.name);
          preview = `<img src="${url}/w-70/h-40/fmt-jpeg/frame-1/${fname}" alt="" draggable=true>`;
        }
        break;
      }
      case "mp3": case "flac": case "ogg": case "aac": case "wav": case "m4a": {
        const url = await F.url();
        if (await FileTransformer.capabilities.ffmpeg) {
          preview = `<img src="${await F.url({w: 70, h: 40, max: true})}" alt="" draggable=true
            onerror="this.replaceWith(Object.assign(document.createElement('audio'),{src:'${url}',controls:true,draggable:true,style:'min-width:4.4rem;width:100%'}))">`;
        } else {
          preview = `<audio src="${url}" controls style="min-width:4.375rem;width:100%" draggable=true>`;
        }
        break;
      }
      default: {
        const text = exists ? ext : "upload";
        preview = `<svg width=70 height=40 style="display:block">
          <rect x=0 y=0 width=70 height=40 fill="var(--cms-color)"></rect>
          <text x=30 y=24 fill="#fff"><tspan text-anchor=middle>${hee(text)}</tspan></text>
        </svg>`;
      }
    }
    const vsName = F.name;
    let linkHtml = "";
    if (!exists) {
      linkHtml = await app.t`Placeholder`;
    } else {
      const url = await F.url();
      const fname = hee(F.name);
      linkHtml = `<a title="${fname}" href="${url}" target=_blank>${hee(vsName)}</a>`;
    }
    const nameLabel = name[0] !== "_" ? `<div style="font-size:11px;color:#999;font-style:italic">(${hee(name)})</div>` : "";
    const size = exists ? await F.size() : 0;
    const sizeStr = size ? String(Math.round(size / 1024)) + " KB" : "";

    out += `<tr itemid="${hee(name)}" draggable>
      <td class=-preview title="${hee(await app.t`Click to replace the file`)}">${preview}
      <td class=-link>${linkHtml}${nameLabel}
      <td class=-size>${sizeStr}
      <td class=-handle u2-draghandle>
      <td class=-delete>`;
  }
  return html.raw(out);
}
