import { html, magick, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    width: { type: "integer", minimum: 1, default: 200 },
    height: { type: "integer", minimum: 1, default: 200 },
    big_width: { type: "integer", minimum: 1, default: 3000 },
    big_height: { type: "integer", minimum: 1, default: 2500 },
    text: { type: "boolean", description: "Shows image captions." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  // PhotoSwipe is a classic script, so it stays imperative — cms.node.js would load it as a module.
  const base = ctx.req.moduleUrl + name + "/pub/photoswipe/dist/";
  ctx.res.html.legacyScripts.add(base + "photoswipe.min.js");
  ctx.res.html.legacyScripts.add(base + "photoswipe-ui-default.min.js");

  const width = Number(node.settings.width()) || 200;
  const height = Number(node.settings.height()) || 200;
  const bigWidth = Number(node.settings.big_width()) || 3000;
  const bigHeight = Number(node.settings.big_height()) || 2500;
  const figures: HtmlString[] = [];
  for (const file of Object.values(await node.files())) {
    if (!await file.exists() || !file.mime.startsWith("image/")) continue;
    const size = await magick.identify(file.path, "%wx%h").catch(() => `${bigWidth}x${bigHeight}`);
    const [realWidth, realHeight] = size.split("x").map(Number);
    const scale = Math.min(bigWidth / realWidth, bigHeight / realHeight, 1);
    const endWidth = Math.round(realWidth * scale);
    const endHeight = Math.round(realHeight * scale);
    const imageUrl = await file.url({ h: bigHeight, w: bigWidth, max: true });
    const previewUrl = await file.url({ h: Math.round(height * 1.5), w: Math.round(width * 1.5) });
    const caption = await node.showText("file_" + file.id);
    figures.push(html`<figure itemprop=associatedMedia itemscope itemtype="http://schema.org/ImageObject">
      <a style="background-image:url(${previewUrl});padding-bottom:${Math.ceil(height * 100 / width)}%" href="${imageUrl}"
        target=_blank itemprop=contentUrl data-width="${endWidth}" data-height="${endHeight}">
        <img src="${previewUrl}" itemprop=thumbnail alt="" hidden>
      </a>
      ${node.settings.text() ? html`<figcaption class=-text itemprop="caption description">${caption}</figcaption>` : ""}
    </figure>`);
  }

  return html`<div>
  <div class=-items style="--c1-items-width:${width}px" itemscope itemtype="http://schema.org/ImageGallery">${html.join(figures)}</div>
  <div class=pswp tabindex=-1 role=dialog aria-hidden=true>
    <div class=pswp__bg></div><div class=pswp__scroll-wrap><div class=pswp__container>
      <div class=pswp__item></div><div class=pswp__item></div><div class=pswp__item></div>
    </div><div class="pswp__ui pswp__ui--hidden"><div class=pswp__top-bar>
      <div class=pswp__counter></div><button class="pswp__button pswp__button--close" title=Close></button>
      <button class="pswp__button pswp__button--share" title=Share></button><button class="pswp__button pswp__button--fs" title=Fullscreen></button>
      <button class="pswp__button pswp__button--zoom" title=Zoom></button><div class=pswp__preloader><div class=pswp__preloader__icn>
        <div class=pswp__preloader__cut><div class=pswp__preloader__donut></div></div>
      </div></div></div><div class="pswp__share-modal pswp__share-modal--hidden pswp__single-tap"><div class=pswp__share-tooltip></div></div>
      <button class="pswp__button pswp__button--arrow--left" title=Previous></button><button class="pswp__button pswp__button--arrow--right" title=Next></button>
      <div class=pswp__caption><div class=pswp__caption__center></div></div>
    </div></div>
  </div>
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: [
      "pub/main.css",
      "pub/photoswipe/dist/photoswipe.css",
      "pub/photoswipe/dist/default-skin/default-skin.css",
    ],
    js: ["pub/main.js"],
  },
};
