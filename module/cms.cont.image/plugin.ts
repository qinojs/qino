import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";

import type { Ctx } from "@qino/qino";
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

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const text = await node.showText("main");

  const settings = node.settings;

  // Use this language's image, then the shared image (which can have an unnamed upload's key).
  const name = "image " + ctx.lang;
  const files = await node.files();
  let img = [files.get(name), files.get("image")].find((file) => file?.mime.startsWith("image/"))
    ?? files.entries().find(([key, file]) => !key.startsWith("image ") && file.mime.startsWith("image/"))?.[1];
  const edit = await node.edit();
  if (edit) {
    // Create the localized placeholders for the editor's upload controls.
    for (const lang of node.app.languages.all) {
      const key = "image " + lang;
      const slot = await node.file(key);
      if (key === name) img ??= slot;
    }
    img ??= await node.file(name);
  }
  const url = await node.cms.url(settings["url_" + ctx.lang]()) || await node.cms.url(settings.url());

  const tag = !edit && url ? "a" : "div";
  const hrefAttr = url ? html` href="${url}"` : "";

  // Style
  // bare numbers are pixel values
  const cssLen = async (prop: string) => {
    const v = String(await settings[prop] ?? "");
    return v ? `${prop}:${/^\d+$/.test(v) ? v + "px" : v};` : "";
  };
  const style = await cssLen("min-height") + await cssLen("max-height");

  const options = {
    alt: text.plain(),
    width: await settings.width,
    height: await settings.height,
    fit: await settings.contain ? "contain" : "cover",
    if: 1,
    style,
    quality: Number(await settings.quality) || null,
    editable: edit ? await img?.url() : null,
  };

  const imgHtml = img ? cms_image(img, options) : "";

  const editHtml = edit ? html.async`
        <div class="-alt-edit qgCMS">
            <input placeholder="${node.app.t`Alt text (screen reader / SEO)`}" cmstxt=${text.id} value="${text.plain()}">
        </div>` : "";

  return html.async`<${tag}${hrefAttr}>\n    ${imgHtml}${editHtml}\n</${tag}>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    settingsSchema,
  },
};
