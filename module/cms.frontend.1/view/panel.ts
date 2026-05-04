/**
 * panel.ts - CMS Frontend Panel
 * Port of cms.frontend.1/view/panel.php
 */

import type { Node } from "../../cms/lib/Node.ts";
import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/context.ts";
import { cmsFrontend1WidgetSidebar, } from "../mod.ts";

export default async function (node: Node): Promise<string> {
  const ctx = getCtx();
  const g = ctx.state;

  g.js_data = g.js_data ?? {};

  const app = node.app;

  const customProxy = ctx.settings["cms.frontend.1"].custom;
  g.js_data.cmsFrontend1Data = await customProxy ?? {};

  const tree     = await cmsFrontend1WidgetSidebar("tree",     node, await app.t`Struktur`,     await app.t`Übersicht aller Seiten, <br>Seiten erstellen, verschieben, löschen...`);
  const settings = await cmsFrontend1WidgetSidebar("settings", node, await app.t`Einstellungen`, await app.t`Einstellungen, Dateien, Rechte der aktuellen Seite`);
  const add      = await cmsFrontend1WidgetSidebar("add",      node, await app.t`Module`,        await app.t`Inhalte hinzufügen, z.B. ein Textfeld oder eine Tabelle`);
  const more     = await cmsFrontend1WidgetSidebar("more",     node, await app.t`Weiteres`,      await app.t`CMS-Feedback, Passwort ändern...`);

  return `<div id=qgCmsFrontend1 class="q1Rst qgCMS -open -sidebar-open">
  <div class=-sidebar>
    <a class="-item qgCMS_editmode_switch -active" href="${hee("")}" title="Bearbeiten (E)">
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
