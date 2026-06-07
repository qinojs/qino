import type { Node } from "../../../cms/lib/Node.ts";
import { hee, getCtx } from "../../../core/mod.ts";

export default async function (node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const host = ctx.req.header("host") ?? "";

  const urlRows = await db.all("SELECT * FROM page_url WHERE page_id = ?", [String(node)]);
  let urlTrs = "";
  for (const row of urlRows) {
    urlTrs += `<tr data-lang="${row.lang}">
      <td>${row.lang}
      <td><input class=-url type=text value="${hee(row.url)}" style="width:100%" maxlength=180>
      <td style="width:10px"><input class=-custom type=checkbox ${row.custom ? "checked" : ""} title="${hee(await app.t`custom`)}">
      <td style="width:10px"><input class=-target ${row.target ? "checked" : ""} type=checkbox title="${hee(await app.t`New window`)}">`;
  }

  const redirectRows = await db.all("SELECT * FROM page_redirect WHERE redirect = ? ORDER BY request", [String(node)]);
  let redirectTrs = `<tr>
    <td style="width:20px;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${host}${ctx.appURL}</small>
    <td style="padding-left:5px"><input class=-add_inp style="width:100%" maxlength=180>
    <td style="width:100px"><button class=-add>${await app.t`add`}</button>`;
  for (const row of redirectRows) {
    redirectTrs += `<tr itemid="${hee(row.request)}">
      <td style="width:20px;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${host}${ctx.appURL}</small>
      <td style="padding-left:5px">${hee(row.request)}
      <td class=-delete style="cursor:pointer;width:20px"><img src="${ctx.sysURL}cms.frontend.2/pub/img/delete.svg" alt="${hee(await app.t`delete`)}">`;
  }

  return `<div class=url-manager pid=${node}>
  <table class="-urls -styled -noborder" style="width:100%"><tbody>${urlTrs}</table>
  <br>
  <b>${await app.t`Direct links`}</b>
  <table class="-directlinks -styled -noborder" style="width:100%"><tbody>${redirectTrs}</table>
</div>
<style>
.url-manager .-custom { display:none; }
.url-manager .-custom:checked { display:block; }
</style>`;
}
