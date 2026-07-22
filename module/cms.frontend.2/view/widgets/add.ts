import { ADMIN, type Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx } from "../../../core/mod.ts";
import { moduleIcon } from "../widget.ts";

// Adding a module = ADMIN ("insertable") on the module axis — edit-only groups don't see it here.
// cms.accessRules lowers e.access to the user's module cap; without it everything stays insertable.
const moduleAccess = (node: Node, module: string) =>
  node.app.fire("module:access", { module, user: getCtx().user, access: ADMIN }).then((e) => e.access);

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const ctx = getCtx();

  const modules = node.cms.getModules();
  const moduleBoxes: HtmlString[] = [];
  for (const [name, mod] of Object.entries(modules)) {
    const modDir = mod.dir;
    const modEntry = await app.db.table("module").entry(name);
    if (await moduleAccess(node, name) < ADMIN) continue;
    if (name === "cms.cont.flexible") continue;
    let desc = "";
    try { if (modDir) desc = await Deno.readTextFile(modDir + "description.txt"); } catch { /* egal */ }
    let title = name.replace("cms.cont.", "");
    title = title.charAt(0).toUpperCase() + title.slice(1).replace(/\./g, " ");
    const svgHtml = await moduleIcon(name, modDir);
    moduleBoxes.push(html`<div itemid="${name}" title="${desc}">
      <div class=-title title="${await modEntry.get("name") ?? name}">${title}</div>
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
    const page = await node.cms.node(Number(id));
    if (page.vs?.type !== "c") continue;
    if ((await page.access()) < 2) continue;
    models.push(page);
  }

  let modelsSection: HtmlString | string = "";
  if (models.length) {
    const modelItems: HtmlString[] = [];
    for (const page of models) {
      if (await moduleAccess(node, String(page.vs.module)) < ADMIN) continue;
      const mName = String(page.vs.module);
      const mDir = app.modules.get(mName)?.dir;
      const svgHtml = await moduleIcon(mName, mDir);
      modelItems.push(html`<div itemid="${page.id}" title="">
        <svg class=-img fill="#fff">${svgHtml}</svg>
        <div class=-title title="${page.id}">${await (await page.title()).string()}</div>
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
