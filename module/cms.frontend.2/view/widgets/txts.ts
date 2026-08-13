import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  const texts = await node.texts();
  const rows = [];
  for (const [name, T] of Object.entries(texts)) {
    rows.push(html`<tr><td>${name}&nbsp;<td style="width:70%"><div class=-txt cmstxt=${T.id} contenteditable>${html.raw(await node.showText(name))}</div>`);
  }
  return html`<table id=qgCmsTxtsWindow>${rows}</table>
  <style>
  #qgCmsTxtsWindow { width:100%; }
  #qgCmsTxtsWindow .-txt { max-height:1.9em; min-height:1.9em; overflow:auto; margin:2px; margin-bottom:5px; padding:6px; background:#fff; resize:vertical; transition:max-height .1s; border:1px solid var(--cms-dark); outline:none; }
  #qgCmsTxtsWindow .-txt:hover { max-height:6em; }
  #qgCmsTxtsWindow .-txt:focus { max-height:30em; border-color:var(--cms-color); }
  </style>`;
}
