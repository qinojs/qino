import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const slides: HtmlString[] = [], texts: HtmlString[] = [];
  for (const [name, file] of await node.files()) {
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
    <div class=b1_slideshow><div class=-slides>${slides}</div></div>
    ${slides.length > 1
      ? html`<button class="-arrow -prev" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>
        <button class="-arrow -next" type=button><span class=-img><svg viewBox="0 0 40 80"><use href="${arrow}"></use></svg></span></button>`
      : ""}
  </div>
  <div class=-body><div class=-content>${texts}</div></div>
</div>`;
}

export const cms = { node: { render, css: ["../cms.cont.slideshow.schwups2/pub/b1_slideshow.css"], js: ["pub/main.js"] } };
