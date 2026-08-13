import { ADMIN, type Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx, moduleIcon } from "../../../core/mod.ts";
import { moduleAccess } from "../widget.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const ctx = getCtx();
  const fallbackIcon = ctx.req.moduleUrl + "cms.frontend.2/pub/img/module_default.svg";

  const modules = node.cms.getModules();
  const moduleBoxes = [];
  for (const [name, mod] of Object.entries(modules)) {
    if (await moduleAccess(node, name) < ADMIN || name === "cms.cont.flexible") continue;
    const modRow = await app.db.table("module").get(name);
    const desc = mod.description;
    let title = name.replace("cms.cont.", "");
    title = title.charAt(0).toUpperCase() + title.slice(1).replace(/\./g, " ");
    const svgHtml = moduleIcon(mod, fallbackIcon);
    moduleBoxes.push(html`<div itemid="${name}" title="${desc}">
      <div class=-title title="${modRow?.$get("name") ?? name}">${title}</div>
      <svg class=-img fill="#fff" aria-hidden=true>${svgHtml}</svg>
    </div>`);
  }

  // Vorlagen
  const modelsV = ctx.settings.cms.models;
  const modelsDefault = await app.settings.cms.models;
  const allIds = [...new Set([...String(modelsV).split(","), ...String(modelsDefault).split(",")].map(s => s.trim()).filter(Boolean))];

  const models = [];
  for (const id of allIds) {
    if (!id) continue;
    const p = await node.cms.node(Number(id));
    if (p.vs?.type !== "c" || await p.access() < 2) continue;
    models.push(p);
  }

  let modelsSection: HtmlString | string = "";
  if (models.length) {
    const modelItems = [];
    for (const page of models) {
      if (await moduleAccess(node, String(page.vs.module)) < ADMIN) continue;
      const mName = String(page.vs.module);
      const svgHtml = moduleIcon(app.modules.get(mName), fallbackIcon);
      modelItems.push(html`<div itemid="${page.id}" title="">
        <svg class=-img fill="#fff">${svgHtml}</svg>
        <div class=-title title="${page.id}">${await (await page.title()).string()}</div>
      </div>`);
    }
    modelsSection = html`<div class=-standalone><br><br><div class=-h1><span>Templates</span></div></div>
    <div class="add-models -module-boxes">${modelItems}</div>`;
  }

  return html.async`<div class="-standalone module-manager">
  <div class=-h1>
    <span>${app.t`Modules`}</span>
    <input placeholder="${app.t`Search`}..." style="width:50%">
  </div>
  <div class="add-modules -module-boxes">${moduleBoxes}</div>
  ${modelsSection}
</div>`;
}
