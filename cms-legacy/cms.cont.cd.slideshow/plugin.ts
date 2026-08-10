import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cmsText } from "../lib/text.ts";

export const name = "cms.cont.cd.slideshow";
export const description = "Legacy slideshow: one image plus its own texts per slide.";
export const needs = ["cms", "cms.image2", "cms.text"];

const settingsSchema = {
  properties: {
    "text zuerst": { type: "boolean", description: "Puts the text column before the image." },
    "bg grau": { type: "boolean", description: "Grey section background." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");

  const arrow = ctx.req.moduleUrl + name + "/pub/arrow.svg#main";
  const arrows = html`<button class="-arrow -prev" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>
              <button class="-arrow -next" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>`;

  const slides: Promise<HtmlString>[] = [];
  for (const [fileName, file] of Object.entries(await node.files())) {
    if (!await file.exists() || !file.mime.startsWith("image/")) continue;
    slides.push(html.async`<div class=-cd_slide>
          <div class=-cd_image>
            <div class=-wrapper>${cms_image2(file, { width: 815, height: 1086 })}
              ${arrows}
            </div>
          </div>
          <div class=-cd_text>
            <div class=-top>
              ${cmsText(node, "small_" + fileName, "h4")}
              ${cmsText(node, "big_" + fileName, "h3")}
              ${cmsText(node, "text_" + fileName, "p")}
            </div>
            <div class=-pager></div>
          </div>
        </div>`);
  }

  const cls = await node.settings["text zuerst"] ? "-TextFirst" : "";
  const style = await node.settings["bg grau"] ? "background:#e2e2e2" : "";

  return html`<section class="${cls}" style="${style}">
  <div class=l1_width>
    <div class=c1-aspectRatio>
      <div class="-inner b1_slideshow">
        <div class=-slides>${html.join(await Promise.all(slides), "\n")}</div>
      </div>
      <div class=-spacer></div>
    </div>
  </div>
</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/b1_slideshow.css", "pub/main.css"],
    js: ["pub/main.js"],
  },
};
