import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.text.freeposition";
export const description = "Legacy absolutely positioned editable text.";
export const needs = ["cms"];

async function render(node: Node): Promise<HtmlString> {
  const top = Math.max(-10000, Math.min(10000, Number(await node.settings.top) || 30));
  const left = Math.max(-10000, Math.min(10000, Number(await node.settings.left) || -30));
  return html`<div style="position:absolute;height:0"><div style="position:relative;top:${top}px;left:${left}px;z-index:1">${await node.showText("main")}</div></div>`;
}

export const cms = { node: { render } };
