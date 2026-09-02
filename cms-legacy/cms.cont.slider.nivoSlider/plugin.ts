import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    width: { type: "integer", minimum: 1, default: 500 },
    height: { type: "integer", minimum: 1, default: 250 },
    effect: { enum: ["fade", "slide"], default: "fade" },
    pauseTime: { type: "integer", minimum: 250, default: 3000 },
    startSlide: { type: "integer", minimum: 0, default: 0 },
    directionNav: { type: "boolean", default: true },
    directionNavHide: { type: "boolean", default: true },
    controlNav: { type: "boolean", default: true },
    keyboardNav: { type: "boolean", default: true },
    pauseOnHover: { type: "boolean", default: true },
    randomStart: { type: "boolean", default: true },
    prevText: { type: "string", default: "Prev" },
    nextText: { type: "string", default: "Next" },
  },
};

async function render(node: Node): Promise<HtmlString> {
  const width = Math.max(1, Number(await node.settings.width) || 500);
  const height = Math.max(1, Number(await node.settings.height) || 250);
  const slides: HtmlString[] = [];
  for (const file of (await node.files()).values()) {
    if (!await file.exists() || !file.mime.startsWith("image/")) continue;
    const caption = await node.showText("file_" + file.id);
    slides.push(html`<div class=-slide>${await cms_image2(file, {
      width,
      height,
      style: "max-width:none;width:100%;height:100%",
      if: 1,
    })}${node.edit || String(caption).replace(/<[^>]*>/g, "").trim() ? html`<div class=-caption>${caption}</div>` : ""}</div>`);
  }

  const controls = await node.settings.controlNav
    ? html`<div class=-controls>${slides.map((_, i) => html`<button type=button data-slide="${i}" aria-label="Slide ${i + 1}"></button>`)}</div>`
    : "";

  return html`<div class=nivoSlider tabindex=0 style="width:${width}px;height:${height}px"
    data-effect="${await node.settings.effect || "fade"}"
    data-pause="${Math.max(250, Number(await node.settings.pauseTime) || 3000)}"
    data-start="${Math.max(0, Number(await node.settings.startSlide) || 0)}"
    data-random="${!!await node.settings.randomStart}"
    data-keyboard="${!!await node.settings.keyboardNav}"
    data-hover="${!!await node.settings.pauseOnHover}"
    data-hide-direction="${!!await node.settings.directionNavHide}">
    <div class=-slides>${slides}</div>
    ${await node.settings.directionNav ? html`<button class="-direction -prev" type=button aria-label="${await node.settings.prevText || "Prev"}"></button>
      <button class="-direction -next" type=button aria-label="${await node.settings.nextText || "Next"}"></button>` : ""}
    ${controls}
  </div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
    js: ["pub/main.js"],
  },
};
