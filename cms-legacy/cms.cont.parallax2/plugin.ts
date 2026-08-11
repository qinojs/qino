import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backgroundAttr } from "../lib/bg.ts";

async function render(node: Node): Promise<HtmlString> {
  return html.async`<section>
  <div class=-viewport>
    <div class=-content${html.raw(await backgroundAttr(node, "Image"))}></div>
    <div class=-over><div>${node.showText("main")}</div></div>
  </div>
</section>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
