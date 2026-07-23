import type { Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx } from "../../../core/mod.ts";
import { tree } from "../../../cms/apt-exports.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const ctx = getCtx();
  const treeShowC = await ctx.settings["cms.frontend.2"].ui.tree_show_c;

  const treeData = await tree(0, {
    in: node,
    filter: treeShowC ? "*" : "p",
  });

  return html.async`<div class="-standalone tree-manager" style="flex:1; margin-bottom:2em" data="${JSON.stringify(treeData)}">
  <div class=-h1>
    <span>${app.t`Structure`}</span>
    <input id=page-add style="width:50%" type=text placeholder="${app.t`New subpage of "${await (await node.title()).string()}"`} " title="${app.t`The new page will be created as a subpage of the selected page. Press Enter to create the page`}">
  </div>
  <div id=tree></div>
</div>
<div class=-standalone>
  <div class=-h1>${app.t`Legend`}</div>
  <table class=-padding style="line-height:1">
    <tr><td><span class=-access-0 style="font-size:1.7em;">&#x2B24;</span><td>${app.t`No permission`}
    <tr><td><span class=-access-1 style="font-size:1.7em;">&#x2B24;</span><td>${app.t`View page`}
    <tr><td><span class=-access-2 style="font-size:1.7em;">&#x2B24;</span><td>${app.t`Edit page`}
    <tr><td><span class=-access-3 style="font-size:1.7em;">&#x2B24;</span><td>${app.t`Edit page and manage permissions`}
    <tr><td style="padding-left:.125rem;"><span style="font-family:'qg_cms';font-size:1.7em;">&#xe900;</span><td>${app.t`The page is not publicly accessible`}
    <tr><td style="padding-left:.125rem"><span style="font-family:'qg_cms';font-size:1.7em;">&#xe901;</span><td>${app.t`The page is scheduled and currently not online`}
  </table>
</div>`;
}
