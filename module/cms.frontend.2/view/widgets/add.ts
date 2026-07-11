import type { Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx } from "../../../core/mod.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const ctx = getCtx();

  const modules = node.cms.getModules();
  const moduleBoxes: HtmlString[] = [];
  for (const [name, mod] of Object.entries(modules)) {
    const modDir = mod.dir;
    const M = await app.db.table("module").entry(name);
    if (!await node.canAddModule(name)) continue;
    if (name === "cms.cont.flexible") continue;
    let desc = "";
    try { if (modDir) desc = await Deno.readTextFile(modDir + "description.txt"); } catch { /* egal */ }
    let title = name.replace("cms.cont.", "");
    title = title.charAt(0).toUpperCase() + title.slice(1).replace(/\./g, " ");
    let svgHtml: HtmlString;
    try {
      if (!modDir) throw new Error();
      await Deno.stat(modDir + "pub/module.svg");
      svgHtml = html`<use href="${ctx.req.modulePath+name}/pub/module.svg#main" />`;
    } catch {
      svgHtml = html`<use href="${ctx.req.modulePath}cms.frontend.2/pub/img/module_default.svg#main" />`;
    }
    moduleBoxes.push(html`<div itemid="${name}" title="${desc}">
      <div class=-title title="${String(await M.get?.("name") ?? name)}">${title}</div>
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
    const P = await node.cms.node(Number(id));
    if (P.vs?.type !== "c") continue;
    if ((await P.access()) < 2) continue;
    models.push(P);
  }

  let modelsSection: HtmlString | string = "";
  if (models.length) {
    const modelItems: HtmlString[] = [];
    for (const P of models) {
      if (!await node.canAddModule(String(P.vs.module))) continue;
      const mName = String(P.vs.module);
      const mDir = app.modules.get(mName)?.dir;
      let svgHtml: HtmlString;
      try {
        if (!mDir) throw new Error();
        await Deno.stat(mDir + "pub/module.svg");
        svgHtml = html`<use href="${ctx.req.modulePath+P.vs.module}/pub/module.svg#main" />`;
      } catch {
        svgHtml = html`<use href="${ctx.req.modulePath}cms.frontend.2/pub/img/module_default.svg#main" />`;
      }
      modelItems.push(html`<div itemid="${P.id}" title="">
        <svg class=-img fill="#fff">${svgHtml}</svg>
        <div class=-title title="${String(P.id)}">${await (await P.title()).string()}</div>
      </div>`);
    }
    modelsSection = html`<div class=-standalone><br><br><div class=-h1><span>Templates</span></div></div>
    <div class="add-models -module-boxes">${html.join(modelItems)}</div>`;
  }

  return html.async`<div class="-standalone module-manager">
  <div class=-h1>
    <span>${app.t`Modules`}</span>
    <input placeholder="${app.t`Search`}..." style="width:50%">
  </div>
  <div class="add-modules -module-boxes">${html.join(moduleBoxes)}</div>
  ${modelsSection}
</div>`;
}
