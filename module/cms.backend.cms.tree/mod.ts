import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Where the page trees start: the page the user picked, else the root. */
const startPage = (node: Node, ctx: Ctx): Promise<Node> =>
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

/** The tree's state in the user's settings: the open pages and whether contents show, both changed by
 *  the list's `toggleOpen`/`value` and `showContents` vars. */
function treeState(ctx: Ctx, vars: Record<string, unknown> = {}): { open: Set<string>; type: string } {
  const admin = ctx.settings.cms.admin;
  const open = new Set(String(admin.openPageNodes() ?? "").split(",").filter(Boolean));
  if (vars.toggleOpen != null) {
    vars.value == "1" ? open.add(String(vars.toggleOpen)) : open.delete(String(vars.toggleOpen));
    admin.openPageNodes([...open].join(","));
  }
  if (vars.showContents != null) admin.showContents(vars.showContents == "1");
  return { open, type: admin.showContents() ? "*" : "p" };
}

/** One page as `walk` hands it to the row. `lead(title)` is the row's first two cells: the number, which
 *  makes it the start, and the title, indented, after the open/close button. */
type TreeRow = { page: Node; access: number; level: number; lead: (title: unknown) => Promise<HtmlString> };

/** The rows of the tree below the start page, open pages with their children. `type` overrides whether
 *  contents show; with `readable`, pages the user may not read are left out, with all below them. */
export async function walk(
  node: Node,
  { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> },
  row: (r: TreeRow) => HtmlString | Promise<HtmlString>,
  opt: { type?: string; readable?: boolean } = {},
): Promise<HtmlString> {
  const state = treeState(ctx, vars), type = opt.type ?? state.type;
  const self = await (await node.page()).url(), startHint = await node.app.t`Set as start point`;
  const rows: (HtmlString | Promise<HtmlString>)[] = [];
  const add = async (parent: Node, level: number) => {
    for (const page of (await parent.children({ type })).values()) {
      const access = await page.access();
      if (opt.readable && !access) continue;
      const open = state.open.has(String(page.id));
      const toggle = (await page.children({ type })).size
        ? html`<button class="u2-unstyle -toggle" data-toggle-node="${node.id}" data-toggle-id="${page.id}" data-toggle-value="${open ? 0 : 1}"><u2-ico icon="${open ? "remove" : "add"}">${open ? "−" : "+"}</u2-ico></button>`
        : html`<span class=-toggle></span>`;
      const lead = (title: unknown) => html.async`<td style="text-align:right; font-weight:bold">
    <a title="${startHint}" href="${backend.toUrl(self, { rp: page.id })}">${page.id}</a>
  <td style="padding-left:${level * .9375}rem"><div style="display:flex; align-items:center">${toggle}${title}</div>`;
      rows.push(row({ page, access, level, lead }));
      if (open) await add(page, level + 1);
    }
  };
  await add(await startPage(node, ctx), 0);
  return html.async`${rows}`;
}

/** A page's title in `lang`, else in a fallback language. */
export async function pageTitle(page: Node, lang: string): Promise<string> {
  const title = await page.title();
  return (title && String(await (await title.orFallback(lang)).get() ?? "").trim()) || "(no text)";
}
