import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const U1 = "https://cdn.jsdelivr.net/gh/u1ui/parallax-bg.el@3.3.4/";

/** Image moving slower than the page, text over it. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  ctx.res.html.styles.add(U1 + "parallax-bg.min.css");
  ctx.res.html.scripts.add(U1 + "parallax-bg.min.js");
  return html.async`<section class=u1-parallax-bg-stage>
	<u1-parallax-bg>${cms_image(await node.file("Image"), { width: 3000 })}</u1-parallax-bg>
	<div class=-over><div thm1-width>${node.cms.text(node, "main")}</div></div>
</section>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
