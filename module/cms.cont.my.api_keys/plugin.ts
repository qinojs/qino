import type { Node } from "../cms/mod.ts";
import { getCtx } from "../core/mod.ts";

export const name = "cms.cont.my.api_keys";
export const needs = ["cms", "api_key"];
export const cms = { node: { js: ["pub/main.js"], render } };

async function render(node: Node): Promise<string> {
  const app = node.app;
  if (!getCtx().user) return `<p>${await app.t`Please sign in.`}</p>`;
  return `<div class="-m-api_keys">
  <div data-list>${await app.t`Loading…`}</div>
  <form data-create>
    <input type="text" data-name placeholder="${await app.t`Name`}">
    <button>${await app.t`Create key`}</button>
  </form>
  <output data-token hidden></output>
  <output class="-msg"></output>
</div>`;
}
