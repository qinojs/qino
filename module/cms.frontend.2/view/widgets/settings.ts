import { hee, getCtx } from "../../../core/mod.ts";
import { cmsFrontend2WidgetAccordion } from "../../mod.ts";
import type { Node } from "../../../cms/lib/Node.ts";
import { $item } from "../../../../deps.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const db = app.db;
  const cms = node.cms;
  const ctx = getCtx();
  
  const T = await node.title();
  const titleVal = hee(await T.string());
  const titleEdit = node.edit ? ` cmstxt=${T.id}` : "";

  const modulePubPath = node.module?.dir ? node.module.dir + "pub/" : null;
  let svgUrl: string;
  try {
    if (!modulePubPath) throw new Error();
    await Deno.stat(modulePubPath + "module.svg");
    svgUrl = ctx.sysURL + node.vs.module + "/pub/module.svg";
  } catch {
    svgUrl = ctx.sysURL + "cms.frontend.2/pub/img/module_default.svg";
  }

  const Module = db.table("module").entry(node.vs.module);
  const modules = node.vs.type === "p" ? await cms.getLayouts() : await cms.getModules();
  let moduleOptions = "";
  for (const name of Object.keys(modules)) {
    moduleOptions += `<option value="${hee(name)}" ${name === node.vs.module ? "selected" : ""}>${name}`;
  }

  const Parent = await node.parent();
  let parentHtml = "";
  if (Parent) {
    const parentType = Parent.vs?.type;
    let parentTitle = (await (await Parent.title()).string()).replace(/<[^>]*>/g, "").trim() || String(Parent);
    if (parentType === "c") parentTitle += ` ${Parent.vs?.module} <span style="font-weight:normal;color:#000;font-size:20px;line-height:.5em;position:relative;margin-bottom:-2px">✎</span>`;
    parentHtml = `<div class=-editparent parent="${Parent}" page-type="${hee(parentType)}">
      ${await app.t`Parent:`}
      <a href="${hee(await Parent.url())}" style="font-weight:bold;">${parentTitle}</a>
    </div>`;
  }

  const showAccessTime = await app.settings["cms.frontend.2"]["show access.time"] ?? false;
  const showUrls       = await app.settings["cms.frontend.2"]["show urls"] ?? false;

  let accordions = "";

  const hasOptions = typeof node.module?.exports?.cms?.node?.options === "function";
  const hasPageSettings = (node.settings[$item].keys?.length ?? 0) > 0;
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
  if (await ctx.user?.get?.("superuser")) accordions += await cmsFrontend2WidgetAccordion("superuser", node, "Superuser");

  return `<div class="-standalone content-manager" pid="${node}" page-type="${hee(node.vs.type)}" style="font-size:1.2em;margin-bottom:1em">
  <div title="Nr.${node}">
    <div class=-h1>
      ${node.vs.type === "p" ? await app.t`Page` : await app.t`Content`}:&nbsp;
      <input${titleEdit} value="${titleVal}" style="color:inherit;background:transparent;letter-spacing:.1em;flex:1;padding:0;border:none;outline:none;font-size:inherit" placeholder="no title">
      <div style="margin-top:-15px">
        <svg class=-img fill="var(--cms-dark)" width="46" height="46" style="display:block">
          <use href="${svgUrl}#main" />
        </svg>
      </div>
    </div>
    <div style="display:flex;margin-bottom:4px;">
      <span title="${hee(String(await Module.get?.("name") ?? ""))}">${node.vs.type === "p" ? "Layout" : "Module"}: </span>
      <select class=-changemodule style="border:none;font-size:inherit;font-weight:bold;flex:1;padding:0;margin-top:-4px;margin-bottom:-3px;background:transparent">
        ${moduleOptions}
      </select>
    </div>
  </div>
  ${parentHtml}
</div>
${accordions}`;
}
