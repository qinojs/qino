import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    singlemode: { type: "boolean", description: "Opening one item closes the others." },
    "items visible in nav": { type: "boolean", description: "Lists the items in the navigation." },
  },
};

/** Native `<details>`: one open at a time through a shared `name`, a linked item (`#cmspid<id>`)
 *  opens by pub/main.js; while editing all are open, without `name`, so their titles can be typed. */
async function render(node: Node) {
  let conts = await node.conts();
  if (!conts.length) conts = [await node.cont("first")];
  const visible = await node.settings["items visible in nav"] ? 1 : 0;
  const edit = await node.edit();
  const name = await node.settings.singlemode ? ` name=accordion${node.id}` : "";
  const items: HtmlString[] = [];
  for (const cont of conts) {
    if (!await cont.isReadable()) continue;
    if (Number(cont.vs.visible) !== visible) await cont.set("visible", visible);
    const title = await cont.showTitle();
    const id = `cmspid${cont.id}`;
    items.push(await html.async`<details id=${id}${html.raw(edit ? " open" : name)}>
		<summary><div${html.raw(edit ? ` contenteditable cmstxt=${title.id}` : "")}>${title}</div></summary>
		<div class=-content>${cont.html()}</div>
	</details>`);
  }
  return html`<div>${items}</div>`;
}

export const cms = { node: { render, settingsSchema, js: ["pub/main.js"] } };
