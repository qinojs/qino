import { hee, html } from "@qino/qino";

import { siteTemplate } from "../lib/siteTemplate.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const settingsSchema = {
  properties: {
    "font-css-file": { type: "string", description: "URL or path to an additional CSS file included before the custom layout." },
  },
};

async function render(node: Node, data: { ctx: Ctx }) {
  const fontCss = String(await node.app.settings[node.module!.name]["font-css-file"] ?? ""); // custom.8 shares this shell
  if (fontCss) data.ctx.res.html.head += `<link rel=stylesheet href="${hee(fontCss.replace(/\|/g, "%7C"))}">\n`;

  return await siteTemplate(node, data) ?? html.async`<div id=container><main>${node.cont("main")}</main></div>`;
}

export const cms = {
  node: {
    render,
  },
};
