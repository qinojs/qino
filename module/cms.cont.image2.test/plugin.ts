import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { DbFile, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** One CSS situation, applied identically to <cms-image2> and to the native <img>. */
type Scene = {
  key: string;
  title: string;
  note: string;
  /** css for the container around the element */
  box?: string;
  /** css for the element itself */
  img?: string;
  /** surround the element with text (float / baseline tests) */
  text?: boolean;
  /** options handed to cms_image2 (native <img> gets the matching attribute where one exists) */
  options?: Record<string, unknown>;
};

const scenes: Scene[] = [
  {
    key: "natural",
    title: "No CSS at all",
    note: "Intrinsic size: cms-image2 gets --image-width/--aspect-ratio from the server, the native img its natural pixel size.",
  },
  {
    key: "width100",
    title: "width:100% in a narrow box",
    note: "The classic fluid image. cms-image2 keeps the aspect ratio through aspect-ratio, the img through its intrinsic ratio.",
    box: "width:14rem;",
    img: "width:100%;",
  },
  {
    key: "maxwidth",
    title: "max-width:100%, box smaller than the image",
    note: "Shrink-only. Watch whether the height follows.",
    box: "width:9rem;",
    img: "max-width:100%;",
  },
  {
    key: "height",
    title: "height:8rem, width:auto",
    note: "Height-driven sizing — a native img computes the width from its ratio, cms-image2 from aspect-ratio.",
    img: "height:8rem;width:auto;",
  },
  {
    key: "box-cover",
    title: "Fixed box 16rem x 6rem",
    note: "Ratio mismatch: cms-image2 crops (object-fit:cover on the inner img), the native img is squashed unless it gets object-fit itself.",
    img: "width:16rem;height:6rem;",
  },
  {
    key: "box-contain",
    title: "Fixed box, fit=contain",
    note: "cms-image2 takes fit=contain, the native img the equivalent object-fit:contain.",
    img: "width:16rem;height:6rem;object-fit:contain;",
    options: { fit: "contain" },
  },
  {
    key: "aspect",
    title: "aspect-ratio:1/1 from CSS",
    note: "Does the CSS ratio win over the server-set --aspect-ratio / over the intrinsic ratio?",
    img: "width:10rem;aspect-ratio:1/1;",
  },
  {
    key: "flex",
    title: "Flex item, flex:1",
    note: "Flex sizing depends on the intrinsic size. cms-image2 is a custom element with min-width:.625rem — it does not shrink the same way.",
    box: "display:flex;gap:.5rem;width:18rem;",
    img: "flex:1;min-width:0;",
  },
  {
    key: "grid",
    title: "Grid cell, stretched",
    note: "Grid stretches both axes: does the image overflow its track?",
    box: "display:grid;grid-template-columns:1fr 1fr;gap:.5rem;width:18rem;height:7rem;",
    img: "width:100%;height:100%;",
  },
  {
    key: "float",
    title: "float:left with text around",
    note: "Floating replaced element vs. floating custom element.",
    img: "float:left;width:7rem;margin:0 .5rem .5rem 0;",
    text: true,
  },
  {
    key: "inline",
    title: "Inline in a line of text",
    note: "Baseline alignment. cms-image2 sets vertical-align:middle itself, an img sits on the baseline.",
    img: "height:2rem;",
    text: true,
  },
  {
    key: "absolute",
    title: "position:absolute;inset:0",
    note: "Filling a positioned parent — cms-image2 is position:relative by default, overriding it changes the inner img's containing block.",
    box: "position:relative;width:16rem;height:7rem;",
    img: "position:absolute;inset:0;width:100%;height:100%;",
  },
  {
    key: "tiny",
    title: "width:2rem",
    note: "Very small: cms-image2 has min-width/min-height .625rem and only requests sizes in 30px steps.",
    img: "width:2rem;",
  },
  {
    key: "border",
    title: "border + padding + border-radius",
    note: "cms-image2 sets padding:0 !important and overflow:hidden — padding is ignored and the rounded corners clip differently.",
    img: "width:12rem;padding:1rem;border:.25rem solid currentColor;border-radius:1rem;background:#8884;",
  },
  {
    key: "overflow",
    title: "Fixed width, overflowing parent",
    note: "Element wider than its parent, parent with overflow:hidden.",
    box: "width:8rem;overflow:hidden;",
    img: "width:16rem;",
  },
  {
    key: "hidden",
    title: "Parent display:none at load, shown later",
    note: "cms-image2 measures the rendered box — with no box it cannot pick a size until the element becomes visible.",
    box: "display:none;",
    img: "width:100%;",
  },
];

const LOREM = "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua.";

function sceneCss(s: Scene): string {
  const sel = `[qcms-mod="cont.image2.test"] [data-scene="${s.key}"]:not(.-nocss)`;
  return (s.box ? `${sel} .-box{${s.box}}\n` : "") + (s.img ? `${sel} .-img{${s.img}}\n` : "");
}

/** the scene css as the visitor sees it, without the qcms-mod prefix */
function sceneCssShort(s: Scene): string {
  return (s.box ? `.-box { ${s.box} }\n` : "") + (s.img ? `.-img { ${s.img} }` : "");
}

function cell(label: string, s: Scene, el: HtmlString): Promise<HtmlString> {
  const body = s.text ? html`${el}${LOREM}` : el;
  return html.async`<div class=-cell>
      <div class=-label>${label}</div>
      <div class=-box>${body}</div>
      <pre class=-info></pre>
    </div>`;
}

async function scene(node: Node, s: Scene, file: DbFile, options: Record<string, unknown>, alt: string): Promise<HtmlString> {
  const custom = await cms_image2(file, { ...options, ...s.options, class: "-img" });
  const native = html`<img class=-img src="${await file.url()}" alt="${alt}" loading=lazy>`;
  return html.async`<section data-scene="${s.key}">
    <h3>${s.title}</h3>
    <p class=-note>${s.note}</p>
    <pre class=-css>${sceneCssShort(s)}</pre>
    <button type=button class=-nocssBtn>${node.app.t`CSS off`}</button>
    <div class=-pair>
    ${cell("cms-image2", s, custom)}
    ${cell("native img", s, native)}
    </div>
  </section>`;
}

async function render(node: Node): Promise<HtmlString> {
  let file: DbFile | undefined;
  for (const f of (await node.files()).values()) {
    if (f.mime.startsWith("image/")) { file = f; break; }
  }
  if (!file) return html.async`<div class=-empty>${node.app.t`Add an image file to this block to run the comparison.`}</div>`;

  const settings = node.settings;
  const options = {
    width: await settings.width,
    height: await settings.height,
    quality: Number(await settings.quality) || null,
  };
  const img = file;
  const alt = String(await img.get("name") ?? "");

  const sections = await Promise.all(scenes.map((s) => scene(node, s, img, options, alt)));
  return html.async`<div>
  <style>${html.raw(scenes.map(sceneCss).join(""))}</style>
  <p class=-note>${node.app.t`Same image twice per row: left as <cms-image2>, right as a native <img>. The CSS below each title is applied to both.`}</p>
  ${sections}
</div>`;
}

export const cms = {
  node: {
    render,
    css: ["pub/main.css"],
    js: ["pub/main.mjs"],
    settingsSchema: {
      properties: {
        width: { type: "integer", minimum: 1, description: "Width the cms-image2 source is generated at." },
        height: { type: "integer", minimum: 1, description: "Height the cms-image2 source is generated at." },
        quality: { type: "integer", minimum: 1, maximum: 100, description: "Quality of the generated cms-image2 source." },
      },
    },
  },
};
