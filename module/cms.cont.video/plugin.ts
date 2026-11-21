import { FileTransformer, html } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    controls: { type: "boolean", default: true, description: "Shows the player's controls." },
    autoplay: { type: "boolean", description: "Starts by itself, muted — browsers only autoplay without sound." },
    muted: { type: "boolean", description: "Starts without sound." },
    loop: { type: "boolean", description: "Starts again at the end." },
  },
};

/** The first video in the block's files plays, the first image is its poster — a file dropped on
    the block comes first, so the newest one wins. */
async function render(node: Node) {
  const files = [...(await node.files()).values()];
  const first = (type: string) => files.find((f) => f.mime.startsWith(type));
  const video = first("video/");
  if (!video) return html.async`<div>${await node.edit() ? html.async`<p>${node.app.t.in("cms.cont.video")`Drop a video file here.`}</p>` : ""}</div>`;

  const { settings } = node;
  const flags = {
    controls: settings.controls() ?? true,
    autoplay: settings.autoplay(),
    muted: settings.autoplay() || settings.muted(),
    loop: settings.loop(),
  };
  const attrs = Object.entries(flags).filter(([, on]) => on).map(([k]) => " " + k).join("");
  // without an image of its own, the poster is the video's first frame — if ffmpeg is there to cut it
  const image = first("image/");
  const poster = image ? await image.url()
    : await FileTransformer.capabilities.ffmpeg ? await video.url({ fmt: "jpg", frame: 1 }) : "";

  return html.async`<div>
  <video src="${await video.url()}"${html.raw(attrs)} playsinline preload=metadata${poster ? html` poster="${poster}"` : ""}></video>
</div>`;
}

export const cms = {
  node: {
    render,
    css: ["pub/main.css"],
    settingsSchema,
  },
};
