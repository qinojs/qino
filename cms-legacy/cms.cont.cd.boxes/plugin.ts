import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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
  const edit = await node.edit();
  for (const nr of boxes) {
    const url = await node.cms.url(node.settings[`link_${nr}`]()) ?? "";
    const image = await cms_image2(await node.file(`bild_${nr}`), { width: 550, if: 1, editable: edit });
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
