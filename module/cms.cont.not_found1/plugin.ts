import { hee, sql, type Ctx } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.not_found1";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {

  // Extract words from request URI for fulltext search
  const words = (ctx.req.appPath.match(/\p{L}+/gu) ?? []).join(" ").trim();

  const possiblePages: Map<string, true> = new Map();

  if (words) {
    const match = sql`MATCH (t.text) AGAINST (${words} IN BOOLEAN MODE)`;
    const rows = await node.app.db.query`SELECT p.id, MAX(${match}) score FROM page p INNER JOIN text t ON p.title_id = t.id WHERE p.searchable AND ${match} GROUP BY p.id ORDER BY score DESC LIMIT 100`;
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

async function renderEditBox(node: Node, ctx: Ctx): Promise<string> {
  if (!node.edit) return "";
  const t = node.app.t;
  // Only show when the rendered page differs from the request target (i.e. we're on the real 404 page)
  if (ctx.cms.mainNode === await node.cms.nodeFromRequest?.()) return "";

  ctx.res.html.styles.add(ctx.req.modulePath + "cms/pub/css/ui.css");
  ctx.res.html.scripts.add(ctx.req.modulePath + "cms.frontend.2/pub/js/frontend.mjs");

  let savedMsg = "";
  if (ctx.req.body?.csrfToken === ctx.csrfToken && "setRedirect" in ctx.req.body) {
    const redirect = String(ctx.req.body.redirect ?? "").trim();
    if (/^(javascript|data|vbscript|file):/i.test(redirect)) {
      savedMsg = `<p style="color:red">${await t`Unsupported redirect target.`}</p>`;
    } else if (redirect) {
      await node.app.db.query`INSERT INTO page_redirect (request, redirect) VALUES (${ctx.req.appPath}, ${redirect}) ON DUPLICATE KEY UPDATE redirect = ${redirect}`;
      savedMsg = `<p style="color:green">${await t`Redirect saved.`}</p>`;
    }
  }

  return `<div class="qgCMS u2-card" style="border:1px solid rgba(0,0,0,.5); background:#fff; margin:10px auto">
  ${savedMsg}
  <div class=-head>${await t`Admin: define direct link to:`}</div>
  <form class=-body method=post style="display:flex; margin:0">
    <input type=hidden name=csrfToken value="${hee(ctx.csrfToken)}">
    <input type=qgcms-page name=redirect style="flex:1 1 auto; box-sizing:border-box; border-right:0">
    <button name=setRedirect>${await t`ok`}</button>
  </form>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
