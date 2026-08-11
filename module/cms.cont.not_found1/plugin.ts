import { html, sql, type Ctx, type HtmlString } from "../core/mod.ts";
import { cmsCtx, type Node } from "../cms/mod.ts";

export const name = "cms.cont.not_found1";
export const description = "Not-found page with suggestions and redirect editing.";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {

  // Extract words from request URI for fulltext search
  const words = (ctx.req.appPath.match(/\p{L}+/gu) ?? []).join(" ").trim();

  const possiblePages = new Set<string>();

  if (words) {
    const match = sql`MATCH (t.text) AGAINST (${words} IN BOOLEAN MODE)`;
    const rows = await node.app.db.query`SELECT p.id, MAX(${match}) score FROM page p INNER JOIN text t ON p.title_id = t.id WHERE p.searchable AND ${match} GROUP BY p.id ORDER BY score DESC LIMIT 100`;
    let limit = 5;
    for (const row of rows) {
      const p = await node.cms.node(row.id);
      if (!await p.access()) continue;
      possiblePages.add(String(row.id));
      if (--limit <= 0) break;
    }
  }
  // Always include the home page (id=2)
  possiblePages.add("2");

  const listItems = [];
  for (const pid of possiblePages) {
    listItems.push(html`<li>${await node.cms.link(await node.cms.node(Number(pid)))}`);
  }

  return html.async`<div>
  <div thm1-width class=u1-width>
    ${node.cms.text(node, "main")}
    <ul>${listItems}</ul>
    ${renderEditBox(node, ctx)}
  </div>
</div>`;
}

async function renderEditBox(node: Node, ctx: Ctx): Promise<HtmlString | string> {
  if (!node.edit) return "";
  const t = node.app.t;
  // Only show when the rendered page differs from the request target (i.e. we're on the real 404 page)
  if (cmsCtx(ctx).mainNode === await node.cms.nodeFromRequest()) return "";

  ctx.res.html.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.2/pub/js/frontend.mjs");

  let savedMsg: HtmlString | string = "";
  if (ctx.req.body?.csrfToken === ctx.csrfToken && "setRedirect" in ctx.req.body) {
    const redirect = String(ctx.req.body.redirect ?? "").trim();
    if (/^(javascript|data|vbscript|file):/i.test(redirect)) {
      savedMsg = html`<p style="color:red">${await t`Unsupported redirect target.`}</p>`;
    } else if (redirect) {
      await node.app.db.table("page_redirect").ensure({ request: ctx.req.appPath, redirect });
      savedMsg = html`<p style="color:green">${await t`Redirect saved.`}</p>`;
    }
  }

  return html.async`<div class="qgCMS u2-card" style="border:1px solid rgba(0,0,0,.5); background:#fff; margin:.625rem auto">
  ${savedMsg}
  <div class=-head>${t`Admin: define direct link to:`}</div>
  <form class=-body method=post style="display:flex; margin:0">
    <input type=hidden name=csrfToken value="${ctx.csrfToken}">
    <input type=qgcms-page name=redirect style="flex:1 1 auto; box-sizing:border-box; border-right:0">
    <button name=setRedirect>${t`ok`}</button>
  </form>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
