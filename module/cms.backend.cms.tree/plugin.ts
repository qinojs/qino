import { html, type HtmlString, unixTime, type Ctx, type App } from "../core/mod.ts";
import { list } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.tree";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Pages", de: "Seiten" });
}

async function render(node: Node, {ctx}: {ctx: Ctx}): Promise<HtmlString> {

  // handle GET params that change user settings; only accept existing nodes the user may read
  if (ctx.req.query.rp) {
    const rp = await node.cms.node(Number(ctx.req.query.rp));
    if (rp.exists() && await rp.access() > 0) ctx.settings.cms.admin.rootPageNode(rp.id);
  }

  const rootId = Number(ctx.settings.cms.admin.rootPageNode()) || 1;
  const rootNode = await node.cms.node(rootId);

  // Breadcrumb path to root node
  const pathParts: HtmlString[] = [];
  for (const C of (await rootNode.path()).values()) {
    const title = (await C.title(ctx.lang)) || "(no text)";
    pathParts.push(html`<a href="${"?rp=" + C.id}">${String(title).trim() || "(no text)"}</a> > `);
  }

  const showContents = !!ctx.settings.cms.admin.showContents();

  const t = node.app.t;
  return html.async`<div class="u2-card" style="flex:0 1 1200px">
  <div class=-head>${t`Structure`}</div>
  <div class=-body>
    <label><input type=checkbox data-toggle-contents${showContents ? " checked" : ""}> ${t`Show contents`}</label>
    <div>${html.join(pathParts)}</div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead>
      <tr>
        <th style="width:20px"> ${t`No.`}
        <th style="min-width:250px"> ${t`Page`}
        <th style="width:80px"> ${t`Online from`}
        <th style="width:80px"> ${t`Online until`}
        <th style="width:80px"> ${t`Public`}
        <th style="width:80px"> ${t`Visible`}
        <th style="width:80px"> ${t`Searchable`}
        <th style="width:160px"> ${t`Layout`}
    <tbody cms-part=list>
      ${await list(node, { ctx, vars: {} })}
  </table>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const db = app.db;
  const t = app.t;
  const now = unixTime();
  const total   = Number(await db.one`SELECT count(*) FROM page WHERE type='p'`);
  const offline = Number(await db.one`SELECT count(*) FROM page WHERE type='p' AND ((online_start != 0 AND online_start > ${now}) OR (online_end != 0 AND online_end < ${now}))`);
  const hidden  = Number(await db.one`SELECT count(*) FROM page WHERE type='p' AND visible=0`);
  return html.async`<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${t`Pages total`}:<td>${total}
  <tr><td>${t`Offline`}:<td>${offline}
  <tr><td>${t`Hidden`}:<td>${hidden}
</table>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: {
      list,
    },
  },
};
