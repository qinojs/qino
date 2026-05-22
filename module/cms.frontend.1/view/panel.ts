/**
 * panel.ts - CMS Frontend Panel
 * Port of cms.frontend.1/view/panel.php
 */

import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/RequestContext.ts";
import { cmsFrontend1WidgetSidebar, } from "../mod.ts";
import type { Node } from "../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  const ctx = getCtx();
  const t = ctx.app.t;

  ctx.html.jsData.cmsFrontend1Data = await ctx.settings["cms.frontend.1"].custom ?? {};

  const tree     = await cmsFrontend1WidgetSidebar("tree",     node, await t`Structure`,    await t`Overview of all pages, <br>create, move, delete pages...`);
  const settings = await cmsFrontend1WidgetSidebar("settings", node, await t`Settings`,     await t`Settings, files, permissions of the current page`);
  const add      = await cmsFrontend1WidgetSidebar("add",      node, await t`Modules`,      await t`Add content, e.g. a text field or a table`);
  const more     = await cmsFrontend1WidgetSidebar("more",     node, await t`More`,         await t`CMS feedback, change password...`);

  return `<div id=qgCmsFrontend1 class="q1Rst qgCMS -open -sidebar-open">
  <div class=-sidebar>
    <a class="-item qgCMS_editmode_switch -active" href="${hee("")}" title="Edit (E)">
      <div style="opacity:0"><i></i></div>
    </a>
    ${tree}
    ${settings}
    ${add}
    ${more}
    <div class=-sensor></div>
  </div>
</div>`;
}
