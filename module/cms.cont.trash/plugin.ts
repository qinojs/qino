import { hee, type Ctx } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.trash";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const app   = node.app;
  const trash = Number(await app.settings.cms?.pageTrash ?? 0);
  if (!trash) return `<div>No trash page configured</div>`;

  const TrashNode = await node.cms.node(trash);
  const items     = [...(await TrashNode.children({ type: "*", access: 2 })).values()];

  let listHtml = "";
  for (const P of items) {
    if (await node.in(P)) continue;
    const title       = hee(await (await P.title()).string() || "(kein Titel)");
    const id          = P.id;
    const deletedTime = Number(await P.settings["__deleted_time"] ?? 0);
    const deletedBy   = hee(String(await P.settings["__deleted_by"]  ?? ""));
    const deletedFrom = Number(await P.settings["__deleted_from"] ?? 0);
    const fromTitle   = deletedFrom ? hee(await (await (await node.cms.node(deletedFrom)).title()).string()) : "";
    const timeHtml    = deletedTime ? `<u2-time datetime="${new Date(deletedTime * 1000).toISOString()}" type=relative></u2-time>` : "";
    const module      = hee(String(P.vs.module ?? ""));
    const previewUrl = hee(ctx.req.basePath + "?cmspid=" + id);
    listHtml += `
<div class="u2-card -item" data-id="${id}" data-url="${previewUrl}">
  <strong>${title}</strong>
  <div style="padding-block:0">
    <table class="u2-table -NoSideGaps" style="--u2-Gap:.2rem;">
      ${deletedTime ? `<tr><th>Gelöscht<td>${timeHtml}` : ""}
      ${deletedBy   ? `<tr><th>Von<td>${deletedBy}` : ""}
      ${fromTitle   ? `<tr><th>Aus<td>${fromTitle}` : ""}
      ${module      ? `<tr><th>Modul<td>${module}` : ""}
      <tr><th>ID<td>${id}
    </table>
  </div>
  <div class="-actions">
    <button class="-restore">Wiederherstellen</button>
    <button class="-remove">Endgültig löschen</button>
  </div>
</div>`;
  }

  if (!listHtml) return `<div><p>Der Papierkorb ist leer.</p></div>`;

  return `
<div>
  <div class="-toolbar">
    <button class="-removeAll">Papierkorb leeren</button>
  </div>
  <div class="-list u2-grid">${listHtml}</div>
  <dialog class="-preview"><iframe></iframe></dialog>
</div>
<script type=module src="${hee(ctx.req.modulePath)}cms.cont.trash/pub/main.js"></script>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
