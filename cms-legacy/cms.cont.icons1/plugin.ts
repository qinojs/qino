import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    width: { type: "string", description: "CSS width of every icon." },
    height: { type: "string", description: "CSS height of every icon." },
    item: {
      type: "object",
      description: "Per file: its link target, keyed by file name.",
      additionalProperties: { type: "object", properties: { href: { type: "string" } } },
    },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");

  const width = String(await node.settings.width ?? "");
  const height = String(await node.settings.height ?? "");
  const items: HtmlString[] = [];

  for (const [fileName, file] of Object.entries(await node.files())) {
    const detail: { target?: string; node?: Node } = {};
    const url = await node.cms.url(String(await node.settings.item[fileName].href ?? ""), detail) ?? "";
    const alt = detail.node ? String(await detail.node.showTitle()) : URL.parse(url)?.host ?? "";
    const tag = url ? "a" : "span";
    const target = detail.target === "_blank" ? " target=_blank" : "";
    items.push(html`<${html.raw(tag)}${html.raw(target)} href="${url}" style="width:${width}; height:${height}">
    <img src="${await file.url()}" alt="${alt}">
  </${html.raw(tag)}>`);
  }

  return html`<div>${html.join(items, "\n  ")}</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
