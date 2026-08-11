import type { Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx } from "../../../core/mod.ts";

export default async function (node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const base = (ctx.req.header("host") ?? "") + ctx.req.appUrl;
  const deleteSrc = ctx.req.moduleUrl + "cms.frontend.2/pub/img/delete.svg";

  const urlRows = await db.query`SELECT * FROM page_url WHERE page_id = ${node.id}`;
  const urlTrs = [];
  for (const row of urlRows) {
    urlTrs.push(html.async`<tr data-lang="${row.lang}">
      <td>${row.lang}
      <td><input class=-url type=text value="${row.url}" style="width:100%" maxlength=180>
      <td style="width:.625rem"><input class=-custom type=checkbox ${row.custom ? "checked" : ""} title="${app.t`custom`}">
      <td style="width:.625rem"><input class=-target ${row.target ? "checked" : ""} type=checkbox title="${app.t`New window`}">`);
  }

  const redirectRows = await db.query`SELECT * FROM page_redirect WHERE redirect = ${node.id} ORDER BY request`;
  const redirectTrs: Array<HtmlString | Promise<HtmlString>> = [html.async`<tr>
    <td style="width:1.25rem;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${base}</small>
    <td style="padding-left:.3125rem"><input class=-add_inp style="width:100%" maxlength=180>
    <td style="width:6.25rem"><button class=-add>${app.t`add`}</button>`];
  for (const row of redirectRows) {
    redirectTrs.push(html.async`<tr itemid="${row.request}">
      <td style="width:1.25rem;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${base}</small>
      <td style="padding-left:.3125rem">${row.request}
      <td class=-delete style="cursor:pointer;width:1.25rem"><img src="${deleteSrc}" alt="${app.t`delete`}">`);
  }

  return html.async`<div class=url-manager pid=${node.id}>
  <table class="-urls -styled -noborder" style="width:100%"><tbody>${urlTrs}</table>
  <br>
  <b>${app.t`Direct links`}</b>
  <table class="-directlinks -styled -noborder" style="width:100%"><tbody>${redirectTrs}</table>
</div>
<style>
.url-manager .-custom { display:none; }
.url-manager .-custom:checked { display:block; }
</style>`;
}
