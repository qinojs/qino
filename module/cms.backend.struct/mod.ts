// Port of cms.backend.struct/index.php + control.php

import { hee } from "../core/lib/util.ts";
import { list } from "./parts/list.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/context.ts";
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
  if (ctx.get.rp) ctx.settings.cms.admin.rootPageNode(parseInt(ctx.get.rp));

  const rootId = parseInt(ctx.settings.cms.admin.rootPageNode() ?? "0") || 1;
  const rootNode = await node.app.cms.node(rootId);

  // Breadcrumb path to root node
  let pathHtml = "";
  for (const C of (await rootNode.path()).values()) {
    const title = (await C.title("de")) || (await C.title("en")) || "(kein Text)";
    pathHtml += `<a href="${hee("?rp=" + C.id)}">${hee(String(title)).trim() || "(kein Text)"}</a> > `;
  }

  const listHtml = await list(node, { ctx, vars: {} });

  return `<div class=c1-box style="flex:0 1 1200px">
\t<div class=-head>Struktur</div>
\t<div class=-body>
\t\t${pathHtml}
\t</div>
\t<table class="c1-style cmsBeTree">
\t\t<thead>
\t\t\t<tr>
\t\t\t\t<th style="width:20px"> Nr.
\t\t\t\t<th style="min-width:250px"> Seite
\t\t\t\t<th style="width:80px"> Online ab
\t\t\t\t<th style="width:80px"> Online bis
\t\t\t\t<th style="width:80px"> Öffentlich
\t\t\t\t<th style="width:80px"> Sichtbar
\t\t\t\t<th style="width:80px"> Durchsuchbar
\t\t\t\t<th style="width:160px"> Layout
\t\t<tbody data-part=list>
\t\t\t${listHtml}
\t</table>
\t<script type=module>
\timport { apt } from '${ctx.sysURL}core/js/apt.js';
\tfunction toggle(el, labels, fn) {
\t\tconst on = el.style.color === 'green';
\t\tfn(!on).then(() => { el.innerHTML = labels[+!on]; el.style.color = !on ? 'green' : 'red'; });
\t\treturn false;
\t}
\tglobalThis.toggleVisible    = (el, pid) => toggle(el, ['unsichtbar','sichtbar'],            v => apt.cms.node(pid).visible.put({value: v}));
\tglobalThis.toggleSearchable = (el, pid) => toggle(el, ['nicht durchsuchbar','durchsuchbar'], v => apt.cms.node(pid).searchable.put({value: v}));
\tglobalThis.toggleAccess     = (el, pid) => toggle(el, ['private','public'],                  v => apt.cms.node(pid).access.put({value: +v}));
\tdocument.querySelector('.cmsBeTree').addEventListener('click', async e => {
\t\tconst a = e.target.closest('[data-toggle-node]');
\t\tif (!a) return;
\t\te.preventDefault();
\t\tconst nid = a.dataset.toggleNode, id = a.dataset.toggleId, val = a.dataset.toggleValue;
\t\tconst html = await apt.cms.node(nid).html.part('list').get({ vars: { toggleOpen: id, value: val } });
\t\ta.closest('tbody[data-part=list]').innerHTML = html;
\t});
\t</script>
</div>`;
}

export const cms = {
  node: {
    render,
    parts: {
      list,
    },
  },
};
