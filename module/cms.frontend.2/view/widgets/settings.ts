import { html, type HtmlString, getCtx } from "../../../core/mod.ts";
import { cmsFrontend2WidgetAccordion } from "../../mod.ts";
import type { Node } from "../../../cms/mod.ts";
import { $item } from "../../../../deps.ts";
import { moduleIcon } from "../../api.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;
  const cms = node.cms;
  const ctx = getCtx();

  const title = await node.title();
  const titleVal = await title.string();
  const titleEdit = node.edit ? html` cmstxt=${title.id}` : "";

  const svgIcon = await moduleIcon(node.vs.module, node.module?.dir);

  const module = db.table("module").entry(node.vs.module);
  const modules = node.vs.type === "p" ? await cms.getLayouts() : await cms.getModules();
  const moduleOptions = html.join(Object.keys(modules).map((name) =>
    html`<option value="${name}" ${name === node.vs.module ? "selected" : ""}>${name}`));

  const parent = await node.parent();
  let parentHtml: HtmlString | string = "";
  if (parent) {
    const parentType = parent.vs?.type;
    let parentTitle = (await (await parent.title()).string()).replace(/<[^>]*>/g, "").trim() || String(parent);
    if (parentType === "c") parentTitle += ` ${parent.vs?.module} <span style="font-weight:normal;color:#000;font-size:20px;line-height:.5em;position:relative;margin-bottom:-2px">✎</span>`;
    parentHtml = await html.async`<div class=-editparent parent="${parent.id}" page-type="${parentType}">
      ${app.t`parent:`}
      <a href="${await parent.url()}" style="font-weight:bold;">${html.raw(parentTitle)}</a>
    </div>`;
  }

  const showAccessTime = await app.settings["cms.frontend.2"]["show access.time"] ?? false;
  const showUrls       = await app.settings["cms.frontend.2"]["show urls"] ?? false;

  let accordions = "";

  const hasOptions = typeof node.module?.plugin?.cms?.node?.options === "function";
  const hasPageSettings = Boolean(node.settings[$item].keys?.length);
  if (hasOptions || hasPageSettings) accordions += await cmsFrontend2WidgetAccordion("options", node, await app.t`Settings`);

  accordions += await cmsFrontend2WidgetAccordion("media", node);
  if (showAccessTime) accordions += await cmsFrontend2WidgetAccordion("access.time", node);
  if ((await node.access()) > 2) {
    accordions += await cmsFrontend2WidgetAccordion("access.grp", node);
    accordions += await cmsFrontend2WidgetAccordion("access.usr", node);
  }
  if (node.vs.type === "p") accordions += await cmsFrontend2WidgetAccordion("seo", node);
  if (showUrls)    accordions += await cmsFrontend2WidgetAccordion("urls", node);
  accordions += await cmsFrontend2WidgetAccordion("extended", node, await app.t`Advanced`);
  if (await ctx.user?.get("superuser")) accordions += await cmsFrontend2WidgetAccordion("superuser", node, "Superuser");

  return html.async`<div class="-standalone content-manager" pid="${node.id}" page-type="${node.vs.type}"
    style="font-size:1.2em;margin-bottom:1em">
  <div title="Nr.${node.id}">
    <div class=-h1>
      ${node.vs.type === "p" ? app.t`Page` : app.t`Content`}:&nbsp;
      <input${titleEdit} value="${titleVal}" style="color:inherit;background:transparent;letter-spacing:.1em;flex:1;padding:0;border:none;outline:none;font-size:inherit" placeholder="no title">
      <div style="margin-top:-15px">
        <svg class=-img fill="var(--cms-dark)" width="46" height="46" style="display:block">
          ${svgIcon}
        </svg>
      </div>
    </div>
    <div style="display:flex;margin-bottom:4px;">
      <span title="${await module.get("name")}">${node.vs.type === "p" ? "Layout" : "Module"}: </span>
      <select class=-changemodule style="border:none;font-size:inherit;font-weight:bold;flex:1;padding:0;margin-top:-4px;margin-bottom:-3px;background:transparent">
        ${moduleOptions}
      </select>
    </div>
  </div>
  ${parentHtml}
</div>
${html.raw(accordions)}`;
}
