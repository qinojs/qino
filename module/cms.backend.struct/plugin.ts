import { hee, unixTime, type RequestContext, type App } from "../core/mod.ts";
import { list } from "./parts/list.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.struct";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.struct", { en: "Pages", de: "Seiten" });
}

async function render(node: Node, {ctx}: {ctx: RequestContext}): Promise<string> {

  // handle GET params that change user settings
  if (ctx.get.rp) ctx.settings.cms.admin.rootPageNode(Number(ctx.get.rp));

  const rootId = Number(ctx.settings.cms.admin.rootPageNode() ?? "0") || 1;
  const rootNode = await node.app.cms.node(rootId);

  // Breadcrumb path to root node
  let pathHtml = "";
  for (const C of (await rootNode.path()).values()) {
    const title = (await C.title(ctx.lang)) || "(no text)";
    pathHtml += `<a href="${hee("?rp=" + C.id)}">${hee(String(title)).trim() || "(no text)"}</a> > `;
  }

  const listHtml = await list(node, { ctx, vars: {} });

  const showContents = !!ctx.settings.cms.admin.showContents();

  const app = node.app;
  return `<div class="u2-card" style="flex:0 1 1200px">
  <div class=-head>${await app.t`Structure`}</div>
  <div class=-body>
    <label><input type=checkbox data-toggle-contents${showContents ? " checked" : ""}> ${await app.t`Show contents`}</label>
    <div>${pathHtml}</div>
  </div>
  <table class="u2-table cmsBeTree">
    <thead>
      <tr>
        <th style="width:20px"> ${await app.t`No.`}
        <th style="min-width:250px"> ${await app.t`Page`}
        <th style="width:80px"> ${await app.t`Online from`}
        <th style="width:80px"> ${await app.t`Online until`}
        <th style="width:80px"> ${await app.t`Public`}
        <th style="width:80px"> ${await app.t`Visible`}
        <th style="width:80px"> ${await app.t`Searchable`}
        <th style="width:160px"> ${await app.t`Layout`}
    <tbody cms-part=list>
      ${listHtml}
  </table>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const db = app.db;
  const now = unixTime();
  const total   = Number(await db.one`SELECT count(*) FROM page WHERE type='p'`);
  const offline = Number(await db.one`SELECT count(*) FROM page WHERE type='p' AND ((online_start != 0 AND online_start > ${now}) OR (online_end != 0 AND online_end < ${now}))`);
  const hidden  = Number(await db.one`SELECT count(*) FROM page WHERE type='p' AND visible=0`);
  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="white-space:nowrap">
  <tr><td>${await app.t`Pages total`}:<td>${hee(String(total))}
  <tr><td>${await app.t`Offline`}:<td>${hee(String(offline))}
  <tr><td>${await app.t`Hidden`}:<td>${hee(String(hidden))}
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
