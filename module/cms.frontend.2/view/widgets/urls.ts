import type { Node } from "../../../cms/mod.ts";
import { html, type HtmlString, getCtx } from "../../../core/mod.ts";

export default async function (node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;

  const base = (ctx.req.header("host") ?? "") + ctx.req.basePath;
  const deleteSrc = ctx.req.modulePath + "cms.frontend.2/pub/img/delete.svg";

  const urlRows = await db.query`SELECT * FROM page_url WHERE page_id = ${String(node)}`;
  const urlTrs: Promise<HtmlString>[] = [];
  for (const row of urlRows) {
    urlTrs.push(html.async`<tr data-lang="${row.lang}">
      <td>${row.lang}
      <td><input class=-url type=text value="${row.url}" style="width:100%" maxlength=180>
      <td style="width:10px"><input class=-custom type=checkbox ${row.custom ? "checked" : ""} title="${app.t`custom`}">
      <td style="width:10px"><input class=-target ${row.target ? "checked" : ""} type=checkbox title="${app.t`New window`}">`);
  }

  const redirectRows = await db.query`SELECT * FROM page_redirect WHERE redirect = ${String(node)} ORDER BY request`;
  const redirectTrs: Array<HtmlString | Promise<HtmlString>> = [html.async`<tr>
    <td style="width:20px;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${base}</small>
    <td style="padding-left:5px"><input class=-add_inp style="width:100%" maxlength=180>
    <td style="width:100px"><button class=-add>${app.t`add`}</button>`];
  for (const row of redirectRows) {
    redirectTrs.push(html.async`<tr itemid="${row.request}">
      <td style="width:20px;white-space:nowrap;padding-right:0"><small style="font-size:.7em">${base}</small>
      <td style="padding-left:5px">${row.request}
      <td class=-delete style="cursor:pointer;width:20px"><img src="${deleteSrc}" alt="${app.t`delete`}">`);
  }

  return html.async`<div class=url-manager pid="${String(node)}">
  <table class="-urls -styled -noborder" style="width:100%"><tbody>${html.join(await Promise.all(urlTrs))}</table>
  <br>
  <b>${app.t`Direct links`}</b>
  <table class="-directlinks -styled -noborder" style="width:100%"><tbody>${html.join(await Promise.all(redirectTrs))}</table>
</div>
<style>
.url-manager .-custom { display:none; }
.url-manager .-custom:checked { display:block; }
</style>`;
}
