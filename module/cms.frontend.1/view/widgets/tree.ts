import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/lib/util.ts";
import { call } from "../../../core/lib/serverInterface.ts";
import { getCtx } from "../../../core/lib/context.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const treeShowC = await ctx.settings["cms.frontend.1"].custom.tree_show_c;

  const treeData = await call("cms::getTree", [0, {
    in: node,
    filter: treeShowC ? "*" : "p",
  }]);
  const treeJson = hee(JSON.stringify(treeData));

  return `<div class="-standalone qgCmsTreeManager" style="flex:1; margin-bottom:2em" data="${treeJson}">
  <div class=-h1>
    <span>${await app.t`Struktur`}</span>
    <input id=cmsPageAddInp style="width:50%" type=text placeholder="${
    hee(
      await app.t`Neue Unterseite von "${await (await node.title()).string()}"`,
    )
  } " title="${await app
    .t`Die neue Seite wird als Unterseite der ausgewählten Seite erstellt. Klicken Sie Enter um die Seite zu erstellen`}" c1-tooltip>
  </div>
  <div id=cmsTreeContainer></div>
</div>
<div class=-standalone>
  <div class=-h1>${await app.t`Legende`}</div>
  <table class=-padding style="line-height:1">
    <tr><td><span class=-access-0 style="font-size:1.7em;">&#x2B24;</span><td>${await app
    .t`Keine Berechtigung`}
    <tr><td><span class=-access-1 style="font-size:1.7em;">&#x2B24;</span><td>${await app
    .t`Seite ansehen`}
    <tr><td><span class=-access-2 style="font-size:1.7em;">&#x2B24;</span><td>${await app
    .t`Seite bearbeiten`}
    <tr><td><span class=-access-3 style="font-size:1.7em;">&#x2B24;</span><td>${await app
    .t`Seite bearbeiten und Berechtigungen verwalten`}
    <tr><td style="padding-left:2px;"><span style="font-family:'qg_cms';font-size:1.7em;">&#xe900;</span><td>${await app
    .t`Die Seite ist nicht öffentlich zugänglich`}
    <tr><td style="padding-left:2px"><span style="font-family:'qg_cms';font-size:1.7em;">&#xe901;</span><td>${await app
    .t`Die Seite ist terminiert und momentan nicht online`}
  </table>
</div>`;
}
