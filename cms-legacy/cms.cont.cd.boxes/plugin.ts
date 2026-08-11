import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

const boxes = [1, 2, 3, 4, 5]; // fixed count, as in the PHP module

const settingsSchema = {
  properties: Object.fromEntries(boxes.map((nr) => [
    `link_${nr}`,
    { type: "integer", minimum: 1, description: `Target page of box ${nr}.`, "x-html": { type: "qgcms-page" } },
  ])),
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const more = ctx.app.t`mehr`;
  const items = [];
  for (const nr of boxes) {
    const url = await node.cms.url(node.settings[`link_${nr}`]()) ?? "";
    const image = await cms_image2(await node.file(`bild_${nr}`), { width: 550, if: 1, editable: node.edit });
    items.push(html.async`<a class=-item href="${url}">
      <div class=-image>${image}</div>
      <div class=-text>
        ${node.showText(`text_${nr}`)}
        <button style="margin-top:.5em">${more}</button>
      </div>
    </a>
    <i class=-spacer></i>`);
  }
  return html.async`<div>${html.join(await Promise.all(items), "\n")}</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
