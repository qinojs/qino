import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.freePosition1";
export const description = "Legacy absolutely positioned content container.";
export const needs = ["cms"];

async function render(node: Node): Promise<HtmlString> {
  const top = Math.max(-10000, Math.min(10000, Number(await node.settings.top) || 30));
  const left = Math.max(-10000, Math.min(10000, Number(await node.settings.left) || -30));
  return html.async`<div style="position:absolute;height:0"><div style="position:relative;top:${top}px;left:${left}px;z-index:1">${node.cont("1")}</div></div>`;
}

export const cms = { node: { render } };
