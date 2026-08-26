import { $item, html, getCtx, moduleIcon } from "@qino/qino";
import { ADMIN } from "@qino/qino/cms";

import { accordion, moduleAccess } from "../widget.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;
  const cms = node.cms;
  const ctx = getCtx();

  const title = await node.title();
  const titleVal = await title.string();
  const titleEdit = node.edit ? html` cmstxt=${title.id}` : "";

  const svgIcon = moduleIcon(node.module, ctx.req.moduleUrl + "cms.frontend.4/pub/img/module_default.svg");

  const module = await db.table("module").get(node.vs.module);
  const modules = node.vs.type === "p" ? cms.getLayouts() : cms.getModules();
  const options = [];
  for (const name of Object.keys(modules)) {
    const current = name === node.vs.module;
    if (!current && await moduleAccess(node, name) < ADMIN) continue; // the write path rejects them anyway; the current one stays visible
    options.push(html`<option value="${name}" ${current ? "selected" : ""}>${name}`);
  }
  const moduleOptions = options;

  const parent = await node.parent();
  let parentHtml: HtmlString | string = "";
  if (parent) {
    const parentType = parent.vs?.type;
    let parentTitle = (await (await parent.title()).string()).replace(/<[^>]*>/g, "").trim() || String(parent);
    if (parentType === "c") parentTitle += ` ${parent.vs?.module} <span style="font-weight:normal;color:#000;font-size:20px;line-height:.5em;position:relative;margin-bottom:-.125rem">✎</span>`;
    parentHtml = await html.async`<div class=-editparent parent="${parent.id}" page-type="${parentType}">
      ${app.t`parent:`}
      <a href="${await parent.url()}" style="font-weight:bold;">${html.raw(parentTitle)}</a>
    </div>`;
  }

  // A module that ships a widget takes the options slot itself, mounted into .-widgets below;
  // otherwise the server renders its options, or the generic settings editor.
  const hasWidget = typeof node.module?.plugin?.cms?.node?.widget === "string";
  const hasOptions = typeof node.module?.plugin?.cms?.node?.options === "function";
  const hasPageSettings = !!node.settings[$item].keys?.length;
  let accordions = "";
  if (!hasWidget && (hasOptions || hasPageSettings)) accordions += await accordion("options", node, await app.t`Settings`);

  accordions += `<div class=-widgets pid="${node.id}"></div>`;
  if (ctx.user?.superuser) {
    accordions += await accordion("txts", node, "Texts");
    accordions += await accordion("superuser", node, "Superuser");
  }

  return html.async`<div class="-standalone content-manager" pid="${node.id}" page-type="${node.vs.type}"
    style="font-size:1.2em;margin-bottom:1em">
  <div title="Nr.${node.id}">
    <div class=-h1>
      ${node.vs.type === "p" ? app.t`Page` : app.t`Content`}:&nbsp;
      <input${titleEdit} value="${titleVal}" style="color:inherit;background:transparent;letter-spacing:.1em;flex:1;padding:0;border:none;outline:none;font-size:inherit" placeholder="no title">
      <div style="margin-top:-.9375rem">
        <svg class=-img fill="var(--cms-dark)" width="46" height="46" style="display:block">
          ${svgIcon}
        </svg>
      </div>
    </div>
    <div style="display:flex;margin-bottom:.25rem;">
      <span title="${module?.$get("name")}">${node.vs.type === "p" ? "Layout" : "Module"}: </span>
      <select class=-changemodule style="border:none;font-size:inherit;font-weight:bold;flex:1;padding:0;margin-top:-.25rem;margin-bottom:-.1875rem;background:transparent">
        ${moduleOptions}
      </select>
    </div>
  </div>
  ${parentHtml}
</div>
${html.raw(accordions)}`;
}
