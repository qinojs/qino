import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";

import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    mode: { type: "string", enum: ["slide", "fade"], default: "slide" },
    controls: { type: "boolean", default: true, description: "Shows the arrows." },
    "full image": { type: "boolean", description: "Fits the complete image instead of cropping it." },
    "min-height": { type: "string", description: "CSS length." },
    "max-height": { type: "string", description: "CSS length." },
    "aspect-ratio": { type: "string", description: "Height to width, e.g. .5." },
  },
};

/** The node's images as slides, each with an editable caption. */
async function render(node: Node) {
  const edit = await node.edit();
  const s = node.settings;
  const fit = await s["full image"] ? { fit: "contain" } : {};
  const slides = [];
  for (const file of (await node.files()).values()) {
    if (!String(await file.get("mime")).startsWith("image/")) continue;
    const caption = await node.showText("file_" + file.id);
    slides.push(html.async`<div class=-item>
				${cms_image(file, { wait: true, width: 2000, height: 500, style: "max-width:none", ...fit })}
				${edit || caption.plain().trim() ? html.raw(`<div class=-caption${edit ? ` contenteditable cmstxt=${caption.id}` : ""}>${caption}</div>`) : ""}
			</div>`);
  }
  const controls = (await s.controls ?? true) ? " controls" : "";
  const style = `min-height:${await s["min-height"] ?? ""}; max-height:${await s["max-height"] ?? ""}; --c1-aspectRatio:${await s["aspect-ratio"] ?? ""};`;
  return html.async`<div>
	<div class=c1-aspectRatio style="${style}">
		<b1-slider class=-inner${html.raw(controls)} mode="${String(await s.mode || "slide")}" play>${slides}</b1-slider>
		<div class=-spacer></div>
	</div>
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/b1_slideshow.css", "pub/main.css"],
    js: ["pub/b1_slideshow.js"],
  },
};
