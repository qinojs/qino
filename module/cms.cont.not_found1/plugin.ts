import { hee, sql, type RequestContext } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.not_found1";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: RequestContext }): Promise<string> {

  // Extract words from request URI for fulltext search
  const words = (ctx.appRequestPath.match(/\p{L}+/gu) ?? []).join(" ").trim();

  const possiblePages: Map<string, true> = new Map();

  if (words) {
    const match = sql`MATCH (t.text) AGAINST (${words} IN BOOLEAN MODE)`;
    const rows = await node.app.db.all`SELECT p.id, MAX(${match}) score FROM page p INNER JOIN text t ON p.title_id = t.id WHERE p.searchable AND ${match} GROUP BY p.id ORDER BY score DESC LIMIT 100`;
    let limit = 5;
    for (const row of rows) {
      const P = await node.cms.node(row.id);
      if (!await P.access()) continue;
      possiblePages.set(String(row.id), true);
      if (--limit <= 0) break;
    }
  }
  // Always include the home page (id=2)
  possiblePages.set("2", true);

  let listItems = "";
  for (const pid of possiblePages.keys()) {
    listItems += `<li>${await node.cms.link(await node.cms.node(Number(pid)))}`;
  }

  const editBox = await renderEditBox(node, ctx);

  return `<div>
  <div thm1-width class=u1-width>
    ${await node.cms.text(node, "main")}
    <ul>${listItems}</ul>
    ${editBox}
  </div>
</div>`;
}

async function renderEditBox(node: Node, ctx: RequestContext): Promise<string> {
  if (!node.edit) return "";
  // Only show when the rendered page differs from the request target (i.e. we're on the real 404 page)
  if (ctx.cms.mainNode === await node.cms.nodeFromRequest?.()) return "";

  ctx.html.styles.add(ctx.sysURL + "cms/pub/css/ui.css");
  ctx.html.scripts.add(ctx.sysURL + "cms.frontend.2/pub/js/frontend.mjs");

  let savedMsg = "";
  if ("setRedirect" in ctx.post && ctx.post.qgToken === ctx.token) {
    const redirect = String(ctx.post.redirect ?? "").trim();
    if (redirect) {
      await node.app.db.query`INSERT INTO page_redirect (request, redirect) VALUES (${ctx.appRequestPath}, ${redirect}) ON DUPLICATE KEY UPDATE redirect = ${redirect}`;
      savedMsg = `<p style="color:green">${await node.app.t`Redirect saved.`}</p>`;
    }
  }

  return `<div class="qgCMS u2-card" style="border:1px solid rgba(0,0,0,.5); background:#fff; margin:10px auto">
  ${savedMsg}
  <div class=-head>${await node.app.t`Admin: define direct link to:`}</div>
  <form class=-body method=post style="display:flex; margin:0">
    <input type=hidden name=qgToken value="${hee(ctx.token)}">
    <input type=qgcms-page name=redirect style="flex:1 1 auto; box-sizing:border-box; border-right:0">
    <button name=setRedirect>${await node.app.t`ok`}</button>
  </form>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
