import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import manifest from "./manifest.json" with { type: "json" };

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

const settingsSchema = {
  properties: {
    mode: { type: "string", enum: ["slide", "fade"], default: "slide" },
    "full image": { type: "boolean", description: "Fits the complete image instead of cropping it." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const slides: HtmlString[] = [];
  for (const file of (await node.files()).values()) {
    if (!await file.exists() || !file.mime.startsWith("image/")) continue;
    const caption = await node.showText("file_" + file.id);
    const captionHtml = node.edit || String(caption).replace(/<[^>]*>/g, "").trim()
      ? html`<div class=-caption>${caption}</div>`
      : "";
    slides.push(html`<div>${await cms_image2(file, {
      width: 2000,
      height: 500,
      fit: node.settings["full image"]() ? "contain" : "cover",
      style: "max-width:none",
      if: 1,
    })}${captionHtml}</div>`);
  }

  const arrow = ctx.req.moduleUrl + name + "/pub/arrow.svg#main";
  const controls = slides.length > 1
    ? html`<button class="-arrow -prev" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>
      <button class="-arrow -next" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>`
    : "";

  return html`<div data-type="${node.settings.mode() || "slide"}">
  <div class=c1-aspectRatio>
    <div class="-inner b1_slideshow"><div class=-slides>${html.join(slides)}</div></div>
    <div class=-spacer></div>
  </div>
  ${controls}
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/b1_slideshow.css", "pub/main.css"],
    js: ["pub/main.js"],
  },
};
