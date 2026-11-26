import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { breadcrumb, walk } from "@qino/qino/cms.backend.cms.tree";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Access", de: "Zugriff" });
}

/** Groups that participate in page access (grp.cms_access > 0). */
function accessGroups(app: App): Promise<Record<string, string | number>[]> {
  return app.db.query`SELECT id, name FROM grp WHERE cms_access > 0 ORDER BY name`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  // only accept existing nodes the user may read
  const admin = ctx.settings.cms.admin;
  const app = node.app;
  const t = app.t;
  const pathParts = await breadcrumb(node, ctx);

  const groups = await accessGroups(app);
  const head = html.join(groups.map(g => html`<th style="width:1.875rem"><div>${g.name}</div>`));

  const listHtml = list(node, { ctx });

  const showContents = admin.showContents();

  return html.async`<div class=u2-card style="flex:0 1 75rem">
  <div class=-head>${t`Access`}</div>
  <div style="display:flex; justify-content:space-between; align-items:center">
    <div>
      <label><input type=checkbox data-toggle-contents${showContents ? " checked" : ""}> ${t`Show contents`}</label>
      <div>${pathParts}</div>
    </div>
    <div style="display:flex; align-items:center; gap:.25rem">
      <span class=-access-1-box></span> ${t`View`}
      <span class=-access-2-box></span> ${t`Edit`}
      <span class=-access-3-box></span> ${t`Administer`}
    </div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead>
      <tr>
        <th style="width:1.25rem"> ${t`No.`}
        <th style="min-width:15.625rem; width:100%"> ${t`Page`}
        <th style="width:1.875rem"><div>${t`Public`}</div>
        ${head}
    <tbody cms-part=list>
      ${listHtml}
  </table>
</div>`;
}

async function list(node: Node, args: { ctx: Ctx; vars?: Record<string, unknown> }) {
  const app = node.app, db = app.db, ctx = args.ctx;
  const groups = await accessGroups(app);
  return walk(node, args, async ({ page, access, lead }) => {
    const id = page.id, isCont = page.vs.type === "c";
    const accessPage = await page.accessInheritParent();
    const inherited = page.vs.access === null;

    const titleObj = await page.title();
    const titleStr = titleObj ? await (await titleObj.orFallback(ctx.lang)).get() : "";
    const titleCell = access >= 1
      ? html.async`<span style="flex:1">${titleStr || "(no text)"} <span style="color:#888">${page.vs.name}</span></span><a style="vertical-align:middle" href="${page.url()}" title=open><u2-ico icon=open_in_new>↗</u2-ico></a>`
      : html.async`<span style="flex:1; color:#bbb">(${app.t`no access`})</span>`;

    // "Public" cell — toggles this page's own access (null = inherited)
    const editable = access > 2;
    const publicV = page.vs.access;
    const publicCell = editable
      ? html`<td class=-cell data-pid="${id}" v="${publicV == null ? "" : (publicV ? 1 : 0)}">`
      : html`<td style="font-style:italic">`;

    // one cell per group
    const grpAccess = editable ? await pageGroupAccess(db, accessPage, groups) : {};
    const grpCells = groups.map((g) => editable
      ? html`<td class=-cell data-pid="${accessPage.id}" data-gid="${g.id}" v="${grpAccess[String(g.id)] ?? 0}" title="${g.name} (${g.id})">`
      : html`<td>`);

    return html.async`
<tr${(isCont || inherited) ? html` class="${[isCont && "-isCont", inherited && "-inherited"].filter(Boolean).join(" ")}"` : ""} data-inherited="${accessPage.id}">
  ${lead(titleCell)}
  ${publicCell}
  ${grpCells}`;
  });
}

/** Map grp_id -> access for a page, for the given groups. */
async function pageGroupAccess(db: App["db"], page: Node, groups: Record<string, string | number>[]) {
  const ret: Record<string, number> = {};
  if (!groups.length) return ret;
  const rows = await db.query`SELECT grp_id, access FROM page_access_grp WHERE page_id = ${page.id}`;
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
