import { hee, type Ctx } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.trash";
export const description = "Deleted CMS nodes with restore and permanent-delete actions.";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const app   = node.app;
  const trash = Number(await app.settings.cms?.pageTrash);
  if (!trash) return `<div>No trash page configured</div>`;

  const trashNode = await node.cms.node(trash);
  const items     = [...(await trashNode.children({ type: "*", access: 2 })).values()];

  let listHtml = "";
  for (const page of items) {
    if (await node.in(page)) continue;
    const title       = hee(await (await page.title()).string() || "(no title)");
    const id          = page.id;
    const deletedTime = Number(await page.settings.__deleted.time);
    const deletedBy   = hee(await page.settings.__deleted.by);
    const deletedFrom = Number(await page.settings.__deleted.from);
    const fromTitle   = deletedFrom ? hee(await (await (await node.cms.node(deletedFrom)).title()).string()) : "";
    const timeHtml    = deletedTime ? `<u2-time datetime="${new Date(deletedTime * 1000).toISOString()}" type=relative></u2-time>` : "";
    const module      = hee(page.vs.module);
    const previewUrl = hee(ctx.req.basePath + "?cmspid=" + id);
    listHtml += `
<div class="u2-card -item" data-id="${id}" data-url="${previewUrl}">
  <strong>${title}</strong>
  <div style="padding-block:0">
    <table class="u2-table -NoSideGaps" style="--u2-Gap:.2rem;">
      ${deletedTime ? `<tr><th>Deleted<td>${timeHtml}` : ""}
      ${deletedBy   ? `<tr><th>By<td>${deletedBy}` : ""}
      ${fromTitle   ? `<tr><th>From<td>${fromTitle}` : ""}
      ${module      ? `<tr><th>Module<td>${module}` : ""}
      <tr><th>ID<td>${id}
    </table>
  </div>
  <div class=-actions>
    <button class=-restore>Restore</button>
    <button class=-remove>Delete permanently</button>
  </div>
</div>`;
  }

  if (!listHtml) return `<div><p>Der Papierkorb ist leer.</p></div>`;

  return `
<div>
  <div class=-toolbar>
    <button class=-removeAll>Papierkorb leeren</button>
  </div>
  <div class="-list u2-grid">${listHtml}</div>
  <dialog class=-preview><iframe></iframe></dialog>
</div>
<script type=module src="${hee(ctx.req.moduleUrl)}cms.cont.trash/pub/main.js"></script>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
