import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Where the page trees start: the page the user picked, else the root. */
export const startPage = (node: Node, ctx: Ctx): Promise<Node> =>
  node.cms.node(Number(ctx.settings.cms.admin.rootPageNode()) || 1);

/** The way from the root to the start page, each step a link that starts there. `?rp=` moves the start
 *  to a page the user can read. The start comes from the user's own settings, so each step is checked
 *  too: a page they may not read is not named. Await it before the tree, which reads the start. */
export async function breadcrumb(node: Node, ctx: Ctx): Promise<HtmlString> {
  if (ctx.req.query.rp) {
    const rp = await node.cms.node(Number(ctx.req.query.rp));
    if (rp.exists() && await rp.access() > 0) ctx.settings.cms.admin.rootPageNode(rp.id);
  }
  const self = await (await node.page()).url();
  const steps = [...(await (await startPage(node, ctx)).path()).values()].map(async (page) => {
    const title = await page.access() > 0 ? await pageTitle(page, ctx.lang) : `(${await node.app.t`no access`})`;
    return html`<a href="${backend.toUrl(self, { rp: page.id })}">${title}</a> > `;
  });
  return html.join(await Promise.all(steps));
}

/** A page's title in `lang`, else in a fallback language. */
export async function pageTitle(page: Node, lang: string): Promise<string> {
  const title = await page.title();
  return (title && String(await (await title.orFallback(lang)).get() ?? "").trim()) || "(no text)";
}
