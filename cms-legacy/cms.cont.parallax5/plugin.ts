import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Image moving slower than the page, text over it. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["el/parallaxbg/parallaxbg.css", "el/parallaxbg/parallaxbg.js"]);
  return html.async`<section class=u2-parallaxbg-stage>
	<u2-parallaxbg>${cms_image(await node.file("Image"), { width: 3000 })}</u2-parallaxbg>
	<div class=-over><div thm1-width>${node.cms.text(node, "main")}</div></div>
</section>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
