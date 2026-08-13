import { hee, html } from "@qino/qino";

import manifest from "./manifest.json" with { type: "json" };

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const lpage = await node.cms.layoutPage(name);
  const font = String(await lpage.settings["google-font"] ?? "").trim();
  if (font) {
    try {
      const url = new URL(font);
      if (["http:", "https:"].includes(url.protocol)) ctx.res.html.head += `<link rel=stylesheet href="${hee(url.href.replace(/\|/g, "%7C"))}">\n`;
    } catch {/**/}
  }
  return html.async`<div id=container><div id=fullHeight>
  <div id=head><div class=width>${lpage.cont("7")}<div class="nav -hover">${lpage.cont("1")}</div>${lpage.cont("6")}</div></div>
  <div id=main><div class=width>
    <div id=left class="side col"><div class=nav>${lpage.cont("2")}</div>${lpage.cont("4")}</div>
    <div id=content class=col>${node.cont("1")}</div>
    <div id=right class="side col">${lpage.cont("5")}${node.cont("2")}</div>
  </div><div class=clear></div></div>
</div><div id=foot><div class=width>${lpage.cont("3")}</div></div></div>`;
}

export const cms = { node: { render, css: ["pub/h5bp.css", "pub/default.css"] } };
