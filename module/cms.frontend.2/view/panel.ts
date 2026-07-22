import { getCtx } from "../../core/mod.ts";
import { cmsFrontend2WidgetSidebar } from "../mod.ts";
import type { Node } from "../../cms/mod.ts";

export default async function (node: Node): Promise<string> {
  const ctx = getCtx();
  const t = ctx.app.t;

  ctx.res.html.jsData.cmsFrontend2Data = (await ctx.settings["cms.frontend.2"].ui) ?? {};

  const tree     = await cmsFrontend2WidgetSidebar("tree",     node, await t`Structure`,    await t`Overview. Create, move, delete pages...`);
  const settings = await cmsFrontend2WidgetSidebar("settings", node, await t`Settings`,     await t`Settings, files, permissions of the current page`);
  const add      = await cmsFrontend2WidgetSidebar("add",      node, await t`Modules`,      await t`Add content, e.g. a text field or a table`);
  const more     = await cmsFrontend2WidgetSidebar("more",     node, await t`More`,         await t`CMS feedback, change password...`);

  return `<qino-cms hidden>
<div id=panel popover=manual class="qgCMS -open -sidebar-open">
  <div class=-sidebar>
    <a class="-item qgCMS_editmode_switch -active" href="" title="Edit (E)">
      <div style="opacity:0"><i></i></div>
    </a>
    ${tree}
    ${settings}
    ${add}
    ${more}
    <div class=-sensor></div>
  </div>
</div>
</qino-cms>`;
}
