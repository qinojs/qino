import type { Node } from "../cms/mod.ts";
import { getCtx, html, type HtmlString } from "../core/mod.ts";

export const name = "cms.cont.my.api_keys";
export const needs = ["cms", "api_key"];
export const cms = { node: { js: ["pub/main.js"], render } };

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  if (!getCtx().user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<div class="-m-api_keys">
  <div data-list>${t`Loading…`}</div>
  <form data-create>
    <input type="text" data-name placeholder="${t`Name`}">
    <button>${t`Create key`}</button>
  </form>
  <output data-token hidden></output>
  <output class="-msg"></output>
</div>`;
}
