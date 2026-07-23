import type { Node } from "../../../cms/mod.ts";
import { html, type HtmlString } from "../../../core/mod.ts";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const placeholderTitle = await app.t`max. 55 characters` + ", " + await app.t`important words first`;

  const titleText = await node.text("_title");
  const descrText  = await node.text("_meta_description");

  const prioVal = (node.settings._seo_priority()) ?? 0.5;

  return html.async`<div class=seo-manager pid=${node.id}>
  ${app.t`Title`}:
  <input style="width:100%;display:block" cmstxt=${titleText.id} value="${await titleText.string()}" required pattern=".{10,55}" maxlength=100 placeholder="${placeholderTitle}">
  <br>
  ${app.t`Description`}:
  <textarea class=-desc style="display:block;width:100%;height:2.8125rem" cmstxt=${descrText.id} required pattern=".{60,156}" maxlength=220 placeholder="${app.t`max. 156 characters`}" rows=4 cols=70>${await descrText.string()}</textarea>
  <br>
  <style>
  .seo-manager :invalid,
  .seo-manager .-invalid.-invalid {
    border-bottom-color:var(--cms-access-3);
  }
  </style>
  ${app.t`The priority of this page relative to other pages on your website.`}:<br>
  <input type=range min=0 max=1 step=.1 value=${prioVal} data-pid=${node.id} class=-seo-prio>
  <br>
</div>`;
}
