import { html } from "@qino/qino";

import { backgroundAttr } from "../lib/bg.ts";

import type { Node } from "@qino/qino/cms";

async function render(node: Node) {
  return html.async`<section>
  <div class=-viewport>
    <div class=-content${html.raw(await backgroundAttr(node, "Image"))}></div>
    <div class=-over><div>${node.showText("main")}</div></div>
  </div>
</section>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
