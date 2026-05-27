import { hee } from "../core/lib/util.ts";
import { list } from "./parts/list.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.struct";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.struct");
  if (P) {
    await P.title("en", "Pages");
    await P.title("de", "Seiten");
  }
}

async function render(node: Node, {ctx}: {ctx: RequestContext}): Promise<string> {

  // handle GET params that change user settings
  if (ctx.get.rp) ctx.settings.cms.admin.rootPageNode(Number(ctx.get.rp));

  const rootId = Number(ctx.settings.cms.admin.rootPageNode() ?? "0") || 1;
  const rootNode = await node.app.cms.node(rootId);

  // Breadcrumb path to root node
  let pathHtml = "";
  for (const C of (await rootNode.path()).values()) {
    const title = (await C.title("en")) || "(no text)";
    pathHtml += `<a href="${hee("?rp=" + C.id)}">${hee(String(title)).trim() || "(no text)"}</a> > `;
  }

  const listHtml = await list(node, { ctx, vars: {} });

  const app = node.app;
  return `<div class="u2-card -m-cms-backend-struct" style="flex:0 1 1200px" data-sys-url="${ctx.sysURL}">
  <div class=-head>${await app.t`Structure`}</div>
  <div class=-body>
    ${pathHtml}
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
    <tbody data-part=list>
      ${listHtml}
  </table>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const db = app.db;
  const now = Math.floor(Date.now() / 1000);
  const total   = Number(await db.one("SELECT count(*) FROM page WHERE type='p'"));
  const offline = Number(await db.one(`SELECT count(*) FROM page WHERE type='p' AND ((online_start != 0 AND online_start > ${now}) OR (online_end != 0 AND online_end < ${now}))`));
  const hidden  = Number(await db.one("SELECT count(*) FROM page WHERE type='p' AND visible=0"));
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
