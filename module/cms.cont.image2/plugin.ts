import type { Node } from "../cms/mod.ts";
import { cms_image2 } from "../cms.image2/mod.ts";
import { html, type Ctx, type HtmlString } from "../core/mod.ts";

export const name = "cms.cont.image2";

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
  const T = await node.showText("main");

  const settings = node.settings;

  let Img = null;
  let url = await node.cms.url(settings.url());

  // Language-specific variants
  for (const l of node.app.languages.all) {
    const LImg = await node.file("image_" + l);
    if (ctx.lang === l && await LImg.exists()) Img = LImg;
    else if (!Img && await LImg.exists()) Img = LImg;
    const lUrl = await node.cms.url(settings["url_" + l]());
    if (ctx.lang === l && lUrl) url = lUrl;
  }
  Img ??= await node.file("image_" + ctx.lang);

  const tag = !node.edit && url ? "a" : "div";
  const hrefAttr = url ? html` href="${url}"` : "";

  // Style
  let style = "";
  let minHeight = String(await settings["min-height"] ?? "");
  if (minHeight && /^\d+$/.test(minHeight)) minHeight += "px";
  if (minHeight) style += `min-height:${minHeight};`;
  let maxHeight = String(await settings["max-height"] ?? "");
  if (maxHeight && /^\d+$/.test(maxHeight)) maxHeight += "px";
  if (maxHeight) style += `max-height:${maxHeight};`;

  const options = {
    alt: String(T),
    width: await settings["width"],
    height: await settings["height"],
    fit: (await settings["contain"]) ? "contain" : "cover",
    if: 1,
    style,
    quality: Number(await settings["quality"]) || null,
    editable: node.edit ? await Img.url() : null,
  };

  const imgHtml = await cms_image2(Img, options);

  let editHtml: HtmlString | string = "";
  if (node.edit) {
    editHtml = await html.async`
        <div class="-alt-edit qgCMS">
            <input placeholder="${node.app.t`Alt text (screen reader / SEO)`}" cmstxt=${T.id} value="${T}">
        </div>
        <style>
        [qcms-mod="cont.image2"] img { min-height:4em; }
        [qcms-mod="cont.image2"] .-alt-edit { position:relative; }
        [qcms-mod="cont.image2"] .-alt-edit > input {
            opacity:0; transition:opacity .3s;
            width:calc(100% - 6px);
            position:absolute; bottom:3px; left:3px; right:3px; margin:0;
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
