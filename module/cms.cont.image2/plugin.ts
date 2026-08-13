import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  additionalProperties: { type: "string" },
  properties: {
    url: { type: "string", title: "Link", description: "Target URL for the image. In the frontend the image is rendered as a link; internal CMS URLs are resolved.", "x-html": { type: "qgcms-page" } },
    "min-height": { type: "string", title: "Min. height", description: "Minimum display height of the image as a CSS value. Plain numbers are automatically interpreted as pixels." },
    "max-height": { type: "string", title: "Max. height", description: "Maximum display height of the image as a CSS value. Plain numbers are automatically interpreted as pixels." },
    width: { type: "integer", minimum: 1, description: "Width at which the image should be generated or delivered." },
    height: { type: "integer", minimum: 1, description: "Height at which the image should be generated or delivered." },
    contain: { type: "boolean", description: "When active, the whole image is fitted in. Otherwise it is cropped to fill the area." },
    quality: { type: "integer", minimum: 1, maximum: 100, description: "Image quality for output. Leave empty to use the default quality of the image processor." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const text = await node.showText("main");

  const settings = node.settings;

  let img = null;
  let url = await node.cms.url(settings.url());

  // Language-specific variants
  for (const l of node.app.languages.all) {
    const langImg = await node.file("image_" + l);
    if (ctx.lang === l && await langImg.exists()) img = langImg;
    else if (!img && await langImg.exists()) img = langImg;
    const lUrl = await node.cms.url(settings["url_" + l]());
    if (ctx.lang === l && lUrl) url = lUrl;
  }
  img ??= await node.file("image_" + ctx.lang);

  const tag = !node.edit && url ? "a" : "div";
  const hrefAttr = url ? html` href="${url}"` : "";

  // Style
  // bare numbers are pixel values
  const cssLen = async (prop: string) => {
    const v = String(await settings[prop] ?? "");
    return v ? `${prop}:${/^\d+$/.test(v) ? v + "px" : v};` : "";
  };
  const style = await cssLen("min-height") + await cssLen("max-height");

  const options = {
    alt: String(text),
    width: await settings.width,
    height: await settings.height,
    fit: await settings.contain ? "contain" : "cover",
    if: 1,
    style,
    quality: Number(await settings.quality) || null,
    editable: node.edit ? await img.url() : null,
  };

  const imgHtml = await cms_image2(img, options);

  let editHtml: HtmlString | string = "";
  if (node.edit) {
    editHtml = await html.async`
        <div class="-alt-edit qgCMS">
            <input placeholder="${node.app.t`Alt text (screen reader / SEO)`}" cmstxt=${text.id} value="${String(text)}">
        </div>
        <style>
        [qcms-mod="cont.image2"] img { min-height:4em; }
        [qcms-mod="cont.image2"] .-alt-edit { position:relative; }
        [qcms-mod="cont.image2"] .-alt-edit > input {
            opacity:0; transition:opacity .3s;
            width:calc(100% - .4rem);
            position:absolute; bottom:.2rem; left:.2rem; right:.2rem; margin:0;
        }
        [qcms-mod="cont.image2"]:hover .-alt-edit > input,
        [qcms-mod="cont.image2"] .-alt-edit > input:focus { opacity:1; }
        </style>`;
  }

  return html.async`<${tag}${hrefAttr}>\n    ${imgHtml}${editHtml}\n</${tag}>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    settingsSchema,
  },
};
