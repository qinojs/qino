import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.redirect";
export const description = "Legacy internal or HTTP redirect content.";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString | string> {
  const raw = String(await node.showText("_redirect")).replace(/<[^>]*>/g, "").trim();
  let target = "";
  if (/^\d+$/.test(raw)) {
    const page = await node.cms.node(Number(raw));
    if (page.exists()) target = await page.url();
  } else {
    try {
      const url = new URL(raw, ctx.req.url.href);
      if (["http:", "https:"].includes(url.protocol)) target = url.href;
    } catch {/**/}
  }
  if (!node.edit && target) {
    ctx.res.headers.set("Location", target);
    ctx.res.status = 302;
    return "";
  }
  return html`<div>${target ? html`<a href="${target}">${target}</a>` : ""}</div>`;
}

export const cms = { node: { render } };
