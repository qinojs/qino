// Port of cms.backend.struct/index.php + control.php

import { hee } from "qg";
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
  for (const C of (await rootNode.Path()).values()) {
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
\t<script>
\ttoggleVisible = function(el, pid) {
\t\tvar callb = function() {
\t\t\tif (el.style.color === 'green') {
\t\t\t\tel.innerHTML = 'unsichtbar'; el.style.color = 'red';
\t\t\t} else {
\t\t\t\tel.innerHTML = 'sichtbar'; el.style.color = 'green';
\t\t\t}
\t\t}
\t\tvar v = el.style.color === 'green' ? 0 : 1;
\t\t$fn('page::setVisible')(pid, v).run(callb);
\t\treturn false;
\t}
\ttoggleSearchable = function(el, pid) {
\t\tvar callb = function() {
\t\t\tif (el.style.color === 'green') {
\t\t\t\tel.innerHTML = 'nicht durchsuchbar'; el.style.color = 'red';
\t\t\t} else {
\t\t\t\tel.innerHTML = 'durchsuchbar'; el.style.color = 'green';
\t\t\t}
\t\t}
\t\tv = el.style.color === 'green' ? 0 : 1;
\t\t$fn('page::setSearchable')(pid, v).run(callb);
\t\treturn false;
\t}
\ttoggleAccess = function(el, pid) {
\t\tvar callb = function() {
\t\t\tif (el.style.color === 'green') {
\t\t\t\tel.innerHTML = 'private'; el.style.color = 'red';
\t\t\t} else {
\t\t\t\tel.innerHTML = 'public'; el.style.color = 'green';
\t\t\t}
\t\t}
\t\tv = el.style.color === 'green' ? 0 : 1;
\t\t$fn('page::setPublic')(pid, v).run(callb);
\t\treturn false;
\t}
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
