// Port of legacy m/cms.backend.struct.grpaccess — group access matrix per page.
import { hee, html, type App, type Ctx, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.tree.access";
export const needs = ["cms.backend", "cms.backend.cms.tree"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Access", de: "Zugriff" });
}

/** Groups that participate in page access (grp.cms_access > 0). */
function accessGroups(app: App): Promise<Record<string, string | number>[]> {
  return app.db.query`SELECT id, name FROM grp WHERE cms_access ORDER BY name`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  // only accept existing nodes the user may read
  if (ctx.req.query.rp) {
    const rp = await node.cms.node(Number(ctx.req.query.rp));
    if (rp.exists() && await rp.access() > 0) ctx.settings.cms.admin.rootPageNode(rp.id);
  }

  const app = node.app;
  const t = app.t;
  const rootId = Number(ctx.settings.cms.admin.rootPageNode()) || 1;
  const rootNode = await node.cms.node(rootId);

  const pathParts: HtmlString[] = [];
  for (const C of (await rootNode.path()).values()) {
    const title = (await C.title(ctx.lang)) || "(no text)";
    pathParts.push(html`<a href="${"?rp=" + C.id}">${String(title).trim() || "(no text)"}</a> > `);
  }

  const groups = await accessGroups(app);
  const head = html.join(groups.map(g => html`<th style="width:30px"><div>${String(g.name)}</div>`));

  const listHtml = await list(node, { ctx });

  const showContents = !!ctx.settings.cms.admin.showContents();

  return html.async`<div class="u2-card" style="flex:0 1 1200px">
  <div class=-head>${t`Access`}</div>
  <div class=-body style="display:flex; justify-content:space-between; align-items:center">
    <div>
      <label><input type=checkbox data-toggle-contents${showContents ? " checked" : ""}> ${t`Show contents`}</label>
      <div>${html.join(pathParts)}</div>
    </div>
    <div style="display:flex; align-items:center; gap:4px">
      <span class=-access-1-box></span> ${t`View`}
      <span class=-access-2-box></span> ${t`Edit`}
      <span class=-access-3-box></span> ${t`Administer`}
    </div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead>
      <tr>
        <th style="width:20px"> ${t`No.`}
        <th style="min-width:250px; width:100%"> ${t`Page`}
        <th style="width:30px"><div>${t`Public`}</div>
        ${head}
    <tbody cms-part=list>
      ${listHtml}
  </table>
</div>`;
}

export async function list(node: Node, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;

  if (vars?.toggleOpen != null) {
    const p = String(vars.toggleOpen);
    const cur: string = ctx.settings.cms.admin.openPageNodes() ?? "";
    const open = new Set(cur.split(",").filter(Boolean));
    if (vars.value == "1") open.add(p);
    else open.delete(p);
    ctx.settings.cms.admin.openPageNodes([...open].join(","));
  }

  if (vars?.showContents != null) ctx.settings.cms.admin.showContents(vars.showContents == "1");

  const openStr: string = ctx.settings.cms.admin.openPageNodes() ?? "";
  const openPageNodes = new Set(openStr.split(",").filter(Boolean));

  const showContents = !!ctx.settings.cms.admin.showContents();
  const treeType = showContents ? "*" : "p";

  const rootId = Number(ctx.settings.cms.admin.rootPageNode()) || 1;
  const rootNode = await node.cms.node(rootId);
  const groups = await accessGroups(app);

  let out = "";
  await renderChildren(rootNode, 0);
  return html.raw(out);

  async function renderChildren(parent: Node, level: number): Promise<void> {
    for (const [id, SubPage] of await parent.children({ type: treeType })) {
      const access = await SubPage.access();
      const open = openPageNodes.has(String(id));
      const isCont = SubPage.vs.type === "c";
      const accessPage = await SubPage.accessInheritParent();
      const inherited = SubPage.vs.access === null;

      const hasChildren = (await SubPage.children({ type: treeType })).size > 0;
      let toggleBtn = "<span class=-toggle></span>";
      if (hasChildren) {
        toggleBtn = `<button class="u2-unstyle -toggle" data-toggle-node="${node.id}" data-toggle-id="${id}" data-toggle-value="${open ? 0 : 1}"><u2-ico icon="${open ? "remove" : "add"}">${open ? "−" : "+"}</u2-ico></button>`;
      }

      const titleObj = await SubPage.title();
      const titleStr = titleObj ? await (await titleObj.orFallback(ctx.lang)).get() : "";
      const titleCell = access >= 1
        ? `<span style="flex:1">${hee(titleStr) || "(no text)"} <span style="color:#888">${hee(
  SubPage.vs.name
)}</span></span><a style="vertical-align:middle" href="${hee(
  await SubPage.url()
)}" title="open"><u2-ico icon=open_in_new>↗</u2-ico></a>`
        : `<span style="flex:1; color:#bbb">(${await app.t`no access`})</span>`;

      // "Public" cell — toggles this page's own access (null = inherited)
      const editable = access > 2;
      const publicV = SubPage.vs.access;
      const publicCell = editable
        ? `<td class=-cell data-pid="${id}" v="${publicV == null ? "" : (publicV ? 1 : 0)}">`
        : `<td style="font-style:italic">`;

      // one cell per group
      let grpCells = "";
      const grpAccess = await pageGroupAccess(db, accessPage, groups);
      for (const g of groups) {
        const v = grpAccess[String(g.id)] ?? 0;
        grpCells += editable
          ? `<td class=-cell data-pid="${accessPage}" data-gid="${g.id}" v="${v}" title="${hee(g.name)} (${g.id})">`
          : "<td>";
      }

      out += `
<tr${(isCont || inherited) ? ` class="${[isCont && "-isCont", inherited && "-inherited"].filter(Boolean).join(" ")}"` : ""} data-inherited="${accessPage}">
  <td style="text-align:right; font-weight:bold">
    <a title="${await app.t`Set as start point`}" href="${hee("?rp=" + id)}">${hee(id)}</a>
  <td style="padding-left:${level * 15}px; white-space:nowrap">
    <div style="display:flex; align-items:center">${toggleBtn}${titleCell}</div>
  ${publicCell}
  ${grpCells}`;

      if (open) await renderChildren(SubPage, level + 1);
    }
  }
}

/** Map grp_id -> access for a page, for the given groups. */
async function pageGroupAccess(db: App["db"], page: Node, groups: Record<string, string | number>[]): Promise<Record<string, number>> {
  const ret: Record<string, number> = {};
  if (!groups.length) return ret;
  const rows = await db.query`SELECT grp_id, access FROM page_access_grp WHERE page_id = ${page}`;
  for (const r of rows) ret[String(r.grp_id)] = Number(r.access) || 0;
  return ret;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
