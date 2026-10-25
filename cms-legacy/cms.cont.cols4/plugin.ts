import { html } from "@qino/qino";

import { cssLength } from "../lib/css.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const node = {
  cols: { type: "integer", minimum: 2, default: 2 },
  "col-gap": { type: "string", description: "Space between the columns; a bare number is em." },
  "row-gap": { type: "string", description: "Space between stacked columns; a bare number is em." },
  "break-at": { type: "string", description: "Column width below which the columns wrap; a bare number is em." },
};
// PHP took the node's gaps from the module's app settings while the node had none of its own
const settingsSchema = {
  properties: {
    "col-gap": { ...node["col-gap"], default: "2em" },
    "row-gap": { ...node["row-gap"], default: "2em" },
    "break-at": { ...node["break-at"], default: "40em" },
  },
};

async function render(cont: Node) {
  const defaults = cont.app.settings[cont.module!.name];
  const length = async (key: string) => cssLength(await cont.settings[key] || await defaults[key], "em");
  const cols = Math.max(2, Number(await cont.settings.cols) || 2);
  const [colGap, rowGap, breakAt] = [await length("col-gap"), await length("row-gap"), await length("break-at")];
  const sel = `[qcms-id="${cont.id}"]`;
  const items: HtmlString[] = [];
  for (let i = 0; i < cols; i++) {
    const basis = cssLength(await cont.settings[`row_${i + 1}`], "em");
    items.push(await html.async`<div${html.raw(basis ? ` style="flex-basis:${basis}"` : "")}>${cont.cont(String(i))}</div>`);
  }
  return html`<div>
	<style>
		${sel} > .u1-flex-gap { --u1-Items-width:20rem; --u1-Row-gap:${rowGap}; --u1-Col-gap:${colGap}; }
		${sel} > .u1-flex-gap > * { flex:1 1 1%; flex-basis:${breakAt}; }
	</style>
	<div class=u1-flex-gap>${items}</div>
</div>`;
}

export const cms = { node: { render, settingsSchema: { properties: node }, css: ["pub/main.css"] } };
export { settingsSchema };
