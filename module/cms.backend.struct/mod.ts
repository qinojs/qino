// Port of cms.backend.struct/index.php + control.php

import { hee } from "../core/lib/util.ts";
import { list } from "./parts/list.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.struct";
export const needs = ["cms.backend"];

// Port of cms.backend.struct/install.php
export async function install({ app }: any): Promise<void> {
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
    const title = (await C.title("de")) || (await C.title("en")) || "(kein Text)";
    pathHtml += `<a href="${hee("?rp=" + C.id)}">${hee(String(title)).trim() || "(kein Text)"}</a> > `;
  }

  const listHtml = await list(node, { ctx, vars: {} });

  return `<div class=c1-box style="flex:0 1 1200px">
  <div class=-head>Struktur</div>
  <div class=-body>
    ${pathHtml}
  </div>
  <table class="c1-style cmsBeTree">
    <thead>
      <tr>
        <th style="width:20px"> Nr.
        <th style="min-width:250px"> Seite
        <th style="width:80px"> Online ab
        <th style="width:80px"> Online bis
        <th style="width:80px"> Öffentlich
        <th style="width:80px"> Sichtbar
        <th style="width:80px"> Durchsuchbar
        <th style="width:160px"> Layout
    <tbody data-part=list>
      ${listHtml}
  </table>
  <script type=module>
  import { apt } from '${ctx.sysURL}core/pub/js/apt.js';
  function toggle(el, labels, fn) {
    const on = el.style.color === 'green';
    fn(!on).then(() => { el.innerHTML = labels[+!on]; el.style.color = !on ? 'green' : 'red'; });
    return false;
  }
  globalThis.toggleVisible    = (el, pid) => toggle(el, ['unsichtbar','sichtbar'],            v => apt.cms.node(pid).visible.put({value: v}));
  globalThis.toggleSearchable = (el, pid) => toggle(el, ['nicht durchsuchbar','durchsuchbar'], v => apt.cms.node(pid).searchable.put({value: v}));
  globalThis.toggleAccess     = (el, pid) => toggle(el, ['private','public'],                  v => apt.cms.node(pid).access.put({value: +v}));
  document.querySelector('.cmsBeTree').addEventListener('click', async e => {
    const a = e.target.closest('[data-toggle-node]');
    if (!a) return;
    e.preventDefault();
    const nid = a.dataset.toggleNode, id = a.dataset.toggleId, val = a.dataset.toggleValue;
    const html = await apt.cms.node(nid).html.part('list').get({ vars: { toggleOpen: id, value: val } });
    a.closest('tbody[data-part=list]').innerHTML = html;
  });
  </script>
</div>`;
}

export async function backendDashboardWidget(app: any): Promise<string> {
  const db = app.db;
  const now = Math.floor(Date.now() / 1000);
  const total   = Number(await db.one("SELECT count(*) FROM page WHERE type='p'"));
  const offline = Number(await db.one(`SELECT count(*) FROM page WHERE type='p' AND ((online_start != 0 AND online_start > ${now}) OR (online_end != 0 AND online_end < ${now}))`));
  const hidden  = Number(await db.one("SELECT count(*) FROM page WHERE type='p' AND visible=0"));
  return `
<table class="c1-style" style="white-space:nowrap">
  <tr><td>Seiten gesamt:<td>${hee(String(total))}
  <tr><td>Offline:<td>${hee(String(offline))}
  <tr><td>Versteckt:<td>${hee(String(hidden))}
</table>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    parts: {
      list,
    },
  },
};
