import { html, type Ctx, type HtmlString } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.cont.trash";
export const description = "Deleted CMS nodes with restore and permanent-delete actions.";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app   = node.app;
  const trash = Number(await app.settings.cms?.pageTrash);
  if (!trash) return html`<div>No trash page configured</div>`;

  const trashNode = await node.cms.node(trash);
  const items     = [...(await trashNode.children({ type: "*", access: 2 })).values()];

  const cards: HtmlString[] = [];
  for (const page of items) {
    if (await node.in(page)) continue;
    const title       = await (await page.title()).string() || "(no title)";
    const id          = page.id;
    const deletedTime = Number(await page.settings.__deleted.time);
    const deletedBy   = await page.settings.__deleted.by;
    const deletedFrom = Number(await page.settings.__deleted.from);
    const fromTitle   = deletedFrom ? await (await (await node.cms.node(deletedFrom)).title()).string() : "";
    const timeHtml    = deletedTime ? html`<u2-time datetime="${new Date(deletedTime * 1000).toISOString()}" type=relative></u2-time>` : "";
    const module      = page.vs.module;
    const previewUrl  = ctx.req.appUrl + "?cmspid=" + id;
    cards.push(html`
<div class="u2-card -item" data-id="${id}" data-url="${previewUrl}">
  <strong>${title}</strong>
  <div style="padding-block:0">
    <table class="u2-table -NoSideGaps" style="--u2-Gap:.2rem;">
      ${deletedTime ? html`<tr><th>Deleted<td>${timeHtml}` : ""}
      ${deletedBy   ? html`<tr><th>By<td>${deletedBy}` : ""}
      ${fromTitle   ? html`<tr><th>From<td>${fromTitle}` : ""}
      ${module      ? html`<tr><th>Module<td>${module}` : ""}
      <tr><th>ID<td>${id}
    </table>
  </div>
  <div class=-actions>
    <button class=-restore>Restore</button>
    <button class=-remove>Delete permanently</button>
  </div>
</div>`);
  }

  if (!cards.length) return html`<div><p>Der Papierkorb ist leer.</p></div>`;

  return html`
<div>
  <div class=-toolbar>
    <button class=-removeAll>Papierkorb leeren</button>
  </div>
  <div class="-list u2-grid">${cards}</div>
  <dialog class=-preview><iframe></iframe></dialog>
</div>
<script type=module src="${ctx.req.moduleUrl}cms.cont.trash/pub/main.js"></script>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
