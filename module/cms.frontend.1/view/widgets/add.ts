import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/lib/util.ts"
import { getCtx } from "../../../core/lib/context.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const ctx = getCtx();
  const isSuperuser = await ctx.user?.get?.("superuser");

  const modules = await node.cms.getModules();
  let moduleBoxes = "";
  for (const [name, mod] of Object.entries(modules)) {
    const modDir = mod.dir;
    const M = await app.db.table("module").Entry(name);
    const hasAccess = await M.get?.("access");
    if (!hasAccess && !isSuperuser) continue;
    if (name === "cms.cont.flexible") continue;
    let desc = "";
    try { if (modDir) desc = await Deno.readTextFile(modDir + "description.txt"); } catch {}
    let title = name.replace("cms.cont.", "");
    title = title.charAt(0).toUpperCase() + title.slice(1).replace(/\./g, " ");
    let svgHtml: string;
    try {
      if (!modDir) throw new Error();
      await Deno.stat(modDir + "pub/module.svg");
      svgHtml = `<use href="${ctx.sysURL+name}/pub/module.svg#main" />`;
    } catch {
      svgHtml = `<use href="${ctx.sysURL}cms.frontend.1/pub/img/module_default.svg#main" />`;
    }
    moduleBoxes += `<div itemid="${hee(name)}" title="${hee(desc)}" todo_c1-tooltip style="--c1-tooltip-delay:.5">
      <div class=-title title="${hee(String(await M.get?.("name") ?? name))}">${title}</div>
      <svg class=-img fill="#fff" aria-hidden=true>${svgHtml}</svg>
    </div>`;
  }

  // Vorlagen
  const modelsV = ctx.settings.cms.models;
  const modelsDefault = await app.settings.cms.models;
  const allIds = [...new Set([...String(modelsV).split(","), ...String(modelsDefault).split(",")].map(s => s.trim()).filter(Boolean))];

  const models = [];
  for (const id of allIds) {
    if (!id) continue;
    const P = await node.cms.node(parseInt(id));
    if (P.vs?.type !== "c") continue;
    if ((await P.access()) < 2) continue;
    models.push(P);
  }

  let modelsSection = "";
  if (models.length) {
    let modelItems = "";
    for (const P of models) {
      const M = await app.db.table("module").Entry(P.vs.module);
      const mAccess = await M.get?.("access");
      if (!mAccess && !isSuperuser) continue;
      const mName = String(await M.get?.("name") ?? "");
      const mDir = app.modules.get(mName)?.dir;
      let svgHtml: string;
      try {
        if (!mDir) throw new Error();
        await Deno.stat(mDir + "pub/module.svg");
        svgHtml = `<use href="${ctx.sysURL+P.vs.module}/pub/module.svg#main" />`;
      } catch {
        svgHtml = `<use href="${ctx.sysURL}cms.frontend.1/pub/img/module_default.svg#main" />`;
      }
      modelItems += `<div itemid="${P.id}" title="">
        <svg class=-img fill="#fff">${svgHtml}</svg>
        <div class=-title title="${hee(String(P.id))}">${await (await P.title()).string()}</div>
      </div>`;
    }
    modelsSection = `<div class=-standalone><br><br><div class=-h1><span>Vorlagen</span></div></div>
    <div class="cmsAddModels -module-boxes">${modelItems}</div>`;
  }

  return `<div class="-standalone qgCmsFront1ModuleManager">
  <div class=-h1>
    <span>${await app.t`Module`}</span>
    <input placeholder="${await app.t`Suchen`}..." style="width:50%">
  </div>
  <div class="cmsAddModule -module-boxes">${moduleBoxes}</div>
  ${modelsSection}
</div>`;
}
