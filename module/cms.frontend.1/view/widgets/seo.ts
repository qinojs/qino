import type { Node } from "../../../cms/lib/Node.ts";
import { hee } from "../../../core/lib/util.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const textTitle = await app.t`Title`;
  const textDescr = await app.t`Description`;
  const textPrio  = await app.t`The priority of this page relative to other pages on your website.`;
  const placeholderTitle = await app.t`max. 55 characters` + ", " + await app.t`important words first`;
  const placeholderDescr = await app.t`max. 156 characters`;

  const Ttitle = await node.text("_title");
  const Tdescr  = await node.text("_meta_description");

  const prioVal = (node.settings._seo_priority()) ?? 0.5;

  return `<div class=qgCmsFront1SeoManager pid=${node}>
  ${textTitle}:
  <input style="width:100%;display:block" cmstxt=${Ttitle.id} value="${hee(await Ttitle.string())}" required pattern=".{10,55}" maxlength=100 placeholder="${hee(placeholderTitle)}">
  <br>
  ${textDescr}:
  <textarea class=-desc style="display:block;width:100%;height:45px" cmstxt=${Tdescr.id} required pattern=".{60,156}" maxlength=220 placeholder="${hee(placeholderDescr)}" rows=4 cols=70>${hee(await Tdescr.string())}</textarea>
  <br>
  <style>
  .qgCmsFront1SeoManager :invalid,
  .qgCmsFront1SeoManager .-invalid.-invalid {
    border-bottom-color:var(--cms-access-3);
  }
  </style>
  ${hee(textPrio)}:<br>
  <input type=range min=0 max=1 step=.1 value=${prioVal} data-pid=${node} class=-seo-prio>
  <br>
</div>`;
}
