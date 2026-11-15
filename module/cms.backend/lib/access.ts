import { getCtx, html } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

/** Shared publication and access card; its data is loaded after the page response. */
export function renderAccess(node: Node, write = true) {
  const ctx = getCtx();
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.backend/pub/access.js");
  return html`<section class=u2-card data-node-access="${node.id}" data-access="${JSON.stringify(node.vs.access ?? null)}" data-write="${write}" style="flex:0 1 28rem;align-self:flex-start;max-inline-size:100%" aria-busy=true>
    <output role=status><u2-ico icon=hourglass_empty>…</u2-ico></output>
  </section>`;
}
