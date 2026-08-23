import { html, getCtx } from "@qino/qino";

import { accordion } from "../widget.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;

  const sName = JSON.stringify(["cms", "models"]);
  const allStr = String(await app.settings.cms.models ?? '');
  const allArr = allStr.split(",").map((v) => v.trim()).filter(Boolean);
  const has = allArr.includes(String(node.id));
  const newArr = [...allArr];
  if (has) { const i = newArr.indexOf(String(node.id)); newArr.splice(i, 1); } else { newArr.push(String(node.id)); }

  const childXML = 'childXML' in node.settings ? String(node.settings.childXML()) : '';

  let extras = "";
  if (ctx.user?.superuser) {
    extras += await accordion("txts", node, "Texts");
    extras += await accordion("sets", node, "Settings");
  }

  return html.async`<div class=advanced-manager pid=${node.id}>
  <label><input class=-visible ${node.vs.visible ? "checked" : ""} type=checkbox> ${app.t`Visible in navigation`}</label><br><br>
  <label><input class=-searchable ${node.vs.searchable ? "checked" : ""} type=checkbox> ${app.t`Searchable`}</label><br><br>
  <label>
    <input class=-model value="${newArr.join(",")}" name="${sName}" type=checkbox ${has ? "checked" : ""}>
    ${app.t`Show as template under "Modules"`}
  </label><br><br>
  <table><tbody style="vertical-align:middle">
    <tr><td>${app.t`Identifier`} (${app.t`Layout position`}):<td><input class=-name value="${node.vs.name}" style="width:15.625rem">
    <tr><td>${app.t`Base`}:<td><input class=-basis type=qgcms-page value="${node.vs.basis}" style="width:15.625rem">
  </table><br>
  ${app.t`Subpage definition`}
  <textarea class=-childXML style="display:block;width:100%;height:7.5rem" rows=4 cols=70>${childXML}</textarea>
  <br>
</div>
${html.raw(extras)}`;
}
