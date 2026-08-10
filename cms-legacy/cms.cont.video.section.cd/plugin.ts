import { hee, html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backgroundAttr } from "../lib/bg.ts";

export const name = "cms.cont.video.section.cd";
export const description = "Legacy full-width section with a looping background video.";
export const needs = ["cms"];

const settingsSchema = {
  properties: {
    darken: { type: "boolean", description: "Renders the page header in white over a dark video." },
  },
};

// The PHP version copied the video into the module's pub/ folder to get a plain URL;
// in qino the dbFile route serves it directly.
async function render(node: Node): Promise<HtmlString> {
  const darken = !!await node.settings.darken;
  const video = await node.file("Background");
  const videoHtml = await video.exists()
    ? html.raw(`<div class=-videoWrapper><video autoplay muted loop playsinline><source src="${hee(await video.url())}" type="video/mp4"></video></div>`)
    : "";

  const darkenStyle = darken
    ? html.raw("<style>.cd_is_top #head { color:#fff; border-bottom:1px solid rgba(255,255,255,.6); }</style>")
    : "";

  return html.async`<section class="${darken ? "-Darken" : ""}"${html.raw(await backgroundAttr(node, "Background Bild"))}>
  ${darkenStyle}
  ${videoHtml}
  <div class=l1_width>${node.showText("main")}</div>
</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
