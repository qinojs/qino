import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { HtmlString, DbFile } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    width: { type: "integer", minimum: 1, description: "Base test width." },
    height: { type: "integer", minimum: 1, description: "Base test height." },
    delay: { type: "integer", minimum: 0, description: "Delay in ms before the real image starts loading." },
    quality: { type: "integer", minimum: 1, maximum: 100, description: "Image quality used for generated variants." },
  },
};

type ImgOptions = Record<string, string | number | boolean | null | Record<string, string>>;

const TESTS: { id: string; title: string; note: string; options: ImgOptions }[] = [
  { id: "cover", title: "Cover fixed", note: "crop, fixed target box", options: { fit: "cover" } },
  { id: "contain", title: "Contain fixed", note: "full image, transparent areas visible", options: { fit: "contain" } },
  { id: "width", title: "Width only", note: "height derived from source ratio", options: { height: null, fit: "cover" } },
  { id: "height", title: "Height only", note: "width derived from source ratio", options: { width: null, fit: "cover" } },
  { id: "natural", title: "Natural size", note: "no width/height option", options: { width: null, height: null, fit: "cover" } },
  { id: "max-100", title: "Max width 100%", note: "common responsive case", options: { fit: "cover", css: { "max-width": "100%" } } },
  { id: "pos-start", title: "Object position 0/0", note: "top left focal point", options: { fit: "cover", hpos: 0, vpos: 0 } },
  { id: "pos-end", title: "Object position 100/100", note: "bottom right focal point", options: { fit: "cover", hpos: 100, vpos: 100 } },
];

async function render(node: Node, { vars }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const { file, w, h, delay, quality, editable } = await data(node);
  const exists = await file.exists();
  const base = { width: w, height: h, quality, editable, wait: true, if: 1, alt: "cms-image2 test image" };

  const basic = html.raw((await Promise.all(TESTS.map((test) => {
    const options = imageOptions(base, test.id, test.options);
    return renderCard(test.id, test.title, test.note, cms_image2(file, options), optionsText(options));
  }))).join(""));

  const flex = html.raw((await Promise.all([
    renderCard("flex-direct", "Flex direct item", "cms-image2 is the flex item beside long min-content text", renderFlexDirect(file, base), "layout:flex direct, image max-width=100%"),
    renderCard("flex-auto", "Flex wrapper min auto", "wrapper keeps the default min-width:auto behavior", renderFlexWrap(file, base, ""), "layout:flex wrapper min-width:auto"),
    renderCard("flex-min0", "Flex wrapper min 0", "same case with min-width:0 on the image column", renderFlexWrap(file, base, "c2t-min0"), "layout:flex wrapper min-width:0"),
    renderCard("min-content", "Width min-content", "container asks for min-content width", renderMinContent(file, base), "layout:width min-content"),
    renderCard("grid-min", "Grid min-content col", "image in a min-content grid column", renderGridMin(file, base), "layout:grid min-content column"),
    renderCard("inline", "Inline flow", "text before and after the inline-block element", renderInline(file, base), "layout:inline flow, max-width=120px"),
  ])).join(""));

  return html.async`
    <section class=cms-image2-test data-delay="${delay}">
      <header class=c2t-head>
        <h2>cms-image2 test</h2>
        <p>${exists ? "Testing the uploaded image." : "Upload an image in edit mode to start the test."} A partly transparent PNG or AVIF is useful for comparing preview, contain and loading states.</p>
      </header>
      <div cms-part=lab>${labPart(node, { vars })}</div>
      <h3>Options</h3>
      <div class=c2t-grid>${basic}</div>
      <h3>Critical layout</h3>
      <div class=c2t-grid>${flex}</div>
    </section>
  `;
}

type LabVars = { width: number; height: number; autoW: boolean; autoH: boolean; fit: "cover" | "contain"; hpos: number; vpos: number; box: number };

async function labPart(node: Node, { vars }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const { file, w, h, quality, editable } = await data(node);
  const lab = labVars(vars?.lab, w, h);
  const options = imageOptions({ quality, editable, wait: true, if: 1, alt: "cms-image2 test image" }, "lab", {
    width: lab.autoW ? null : lab.width,
    height: lab.autoH ? null : lab.height,
    fit: lab.fit,
    hpos: lab.hpos,
    vpos: lab.vpos,
    css: { "max-width": lab.width + "px" },
  });
  return renderLab(file, options, lab);
}

function renderLab(file: DbFile, options: ImgOptions, lab: LabVars): Promise<HtmlString> {
  return html.async`
    <article class="c2t-card c2t-lab" data-c2t-case=lab data-c2t-params="${optionsText(options)}">
      <h3>Interactive image</h3>
      <form class=c2t-lab-form>
        <div class=c2t-field>
          <label>Width <input type=range min=40 max=1400 value="${lab.width}" data-c2t-param=width><output></output></label>
          <label class=c2t-auto><input type=checkbox data-c2t-auto=width ${lab.autoW ? "checked" : ""}> auto</label>
        </div>
        <div class=c2t-field>
          <label>Height <input type=range min=40 max=900 value="${lab.height}" data-c2t-param=height><output></output></label>
          <label class=c2t-auto><input type=checkbox data-c2t-auto=height ${lab.autoH ? "checked" : ""}> auto</label>
        </div>
        <label>Fit <select data-c2t-param=fit><option value=cover ${lab.fit === "cover" ? "selected" : ""}>cover</option><option value=contain ${lab.fit === "contain" ? "selected" : ""}>contain</option></select><output></output></label>
        <label>H pos <input type=range min=0 max=100 value="${lab.hpos}" data-c2t-param=hpos><output></output></label>
        <label>V pos <input type=range min=0 max=100 value="${lab.vpos}" data-c2t-param=vpos><output></output></label>
        <label>Box <input type=range min=120 max=1100 value="${lab.box}" data-c2t-param=box><output></output></label>
        <button type=button data-c2t-reload>Reload preview</button>
      </form>
      <div class=c2t-stage style="width:min(100%, ${lab.box}px)">${cms_image2(file, options)}</div>
      <output class=c2t-metric></output>
      <code class=c2t-params>${optionsText(options)}</code>
    </article>
  `;
}

async function data(node: Node) {
  const settings = node.settings;
  const file = await node.file("image");
  const w = Number(await settings["width"]) || 360;
  const h = Number(await settings["height"]) || 220;
  const delay = Number(await settings["delay"]) || 1800;
  const quality = Number(await settings["quality"]) || null;
  const editable = await node.edit() ? await file.url() : null;
  return { file, w, h, delay, quality, editable };
}

function renderCard(
  id: string, title: string, note: string, content: Promise<HtmlString> | HtmlString, params: string,
): Promise<string> {
  return html.async`
    <article class=c2t-card data-c2t-case="${id}" data-c2t-params="${params}">
      <h4>${title}</h4>
      <p>${note}</p>
      <div class=c2t-stage>${content}</div>
      <output class=c2t-metric></output>
      <code class=c2t-params>${params}</code>
    </article>
  `.then(String);
}

function image(file: DbFile, base: ImgOptions, id: string, opts: ImgOptions = {}): Promise<HtmlString> {
  return cms_image2(file, imageOptions(base, id, opts));
}

function imageOptions(base: ImgOptions, id: string, opts: ImgOptions = {}): ImgOptions {
  return { ...base, fit: "cover", "data-test": id, ...opts };
}

function optionsText(options: ImgOptions): string {
  const SKIP = new Set(["alt", "editable", "if", "quality", "wait", "data-test"]);
  return Object.entries(options).filter(([k, v]) => !SKIP.has(k) && v != null && v !== false).map(([k, v]) =>
    k === "css" && v && typeof v === "object" ? "css:" + Object.entries(v).map(([ck, cv]) => `${ck}=${cv}`).join(",") : `${k}=${v}`
  ).join(", ");
}

function labVars(v: unknown, w: number, h: number): LabVars {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    width: clamp(o.width, 40, 1400, w),
    height: clamp(o.height, 40, 900, h),
    autoW: !!o.autoW,
    autoH: !!o.autoH,
    fit: o.fit === "contain" ? "contain" : "cover",
    hpos: clamp(o.hpos, 0, 100, 50),
    vpos: clamp(o.vpos, 0, 100, 50),
    box: clamp(o.box, 120, 1100, 720),
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function renderFlexDirect(file: DbFile, base: ImgOptions): Promise<HtmlString> {
  return html.async`
    <div class="c2t-flex c2t-tight">
      ${image(file, base, "flex-direct", { css: { "max-width": "100%" }, style: "flex:1 1 auto;" })}
      <span>long-long-long-min-content-side</span>
    </div>
  `;
}

function renderFlexWrap(file: DbFile, base: ImgOptions, cls: string): Promise<HtmlString> {
  return html.async`
    <div class="c2t-flex c2t-tight">
      <div class="c2t-flex-img ${cls}">${image(file, base, cls || "flex-auto", { css: { "max-width": "100%" } })}</div>
      <span>long-long-long-min-content-side</span>
    </div>
  `;
}

function renderMinContent(file: DbFile, base: ImgOptions): Promise<HtmlString> {
  return html.async`<div class=c2t-min-content>${image(file, base, "min-content", { css: { "max-width": "100%" } })}</div>`;
}

function renderGridMin(file: DbFile, base: ImgOptions): Promise<HtmlString> {
  return html.async`
    <div class=c2t-grid-min>
      ${image(file, base, "grid-min", { css: { "max-width": "100%" } })}
      <span>grid-side-content</span>
    </div>
  `;
}

function renderInline(file: DbFile, base: ImgOptions): Promise<HtmlString> {
  return html.async`
    <p class=c2t-inline>before ${image(file, base, "inline", { css: { "max-width": "120px" } })} after</p>
  `;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { lab: labPart },
    settingsSchema,
  },
};
