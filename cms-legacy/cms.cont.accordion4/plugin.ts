import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    singlemode: { type: "boolean", description: "Opening one item closes the others." },
    "items visible in nav": { type: "boolean", description: "Lists the items in the navigation." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1/accordion.js");
  let conts = await node.conts();
  if (!conts.length) conts = [await node.cont("first")];
  const visible = await node.settings["items visible in nav"] ? 1 : 0;
  const edit = await node.edit();
  const items: HtmlString[] = [];
  for (const cont of conts) {
    if (!await cont.isReadable()) continue;
    if (Number(cont.vs.visible) !== visible) await cont.set("visible", visible);
    const title = await cont.showTitle();
    const id = `cmspid${cont.id}`;
    items.push(await html.async`<dt class=-trigger role=button aria-controls=${id}-panel tabindex=0 aria-expanded=false id=${id}>
		<div id=${id}-title${html.raw(edit ? ` contenteditable cmstxt=${title.id}` : "")}>${title}</div>
	</dt>
	<dd id=${id}-panel class=-panel role=region aria-labelledby=${id}-title hidden>
		<div class=-content>${cont.html()}</div>
	</dd>`);
  }
  const single = await node.settings.singlemode ? " data-singlemode" : "";
  return html`<dl role=presentation class=c1-accordion${html.raw(single)}>${items}</dl>`;
}

export const cms = { node: { render, settingsSchema } };
