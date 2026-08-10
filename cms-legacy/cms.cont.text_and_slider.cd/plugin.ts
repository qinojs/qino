import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.text_and_slider.cd";
export const description = "Legacy synchronized image slider and text panels.";
export const needs = ["cms", "cms.image2"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");
  const slides: HtmlString[] = [], texts: HtmlString[] = [];
  for (const [name, file] of Object.entries(await node.files())) {
    if (!file.mime.startsWith("image/")) continue;
    if (name.startsWith("_")) {
      slides.push(html`<div data-id="${name}">${await cms_image2(file, {
        width: 2000,
        height: 2000,
        style: "max-width:none",
        editable: node.edit,
      })}</div>`);
    }
    texts.push(await html.async`<div data-id="${name}">${node.showText("file_" + name)}</div>`);
  }
  const floating = await cms_image2(await node.file("fliegendes Bild"), {
    width: 400,
    class: "-floating_img",
    fit: "contain",
    if: 1,
    editable: node.edit,
  });
  const arrow = ctx.req.moduleUrl + "cms.cont.slideshow.schwups2/pub/arrow.svg#main";

  return html`<div>
  <div class=-slideshow>
    ${floating}
    <div class=b1_slideshow><div class=-slides>${html.join(slides)}</div></div>
    ${slides.length > 1
      ? html`<button class="-arrow -prev" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>
        <button class="-arrow -next" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>`
      : ""}
  </div>
  <div class=-body><div class=-content>${html.join(texts)}</div></div>
</div>`;
}

export const cms = { node: { render, css: ["../cms.cont.slideshow.schwups2/pub/b1_slideshow.css"], js: ["pub/main.js"] } };
