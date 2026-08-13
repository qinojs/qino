import { html } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const active = cmsCtx(ctx).mainNode;
  const startId = Number(await node.settings.startPage);
  let start = startId ? await node.cms.node(startId) : await node.page();
  const startLevel = Number(await node.settings.startLevel);
  if (startLevel) start = await active.parent(startLevel) ?? start;
  const invert = !!await node.settings.invertVisible;
  const maxLevel = Math.max(0, Number(await node.settings.level) || 0);

  const branch = async (parent: Node, level: number): Promise<HtmlString | undefined> => {
    if (maxLevel && level >= maxLevel) return;
    const children = [...(await parent.children("readable")).values()].filter((child) => !!child.vs.visible !== invert);
    if (!children.length) return;
    const items: HtmlString[] = [];
    for (const child of children) {
      const sub = await active.in(child) ? await branch(child, level + 1) : undefined;
      items.push(await html.async`<li>${node.cms.link(child)}${sub}</li>`);
    }
    return html`<div class=level><ul class="cmsChilds${parent.id}">${html.join(items)}<div class=clear></div></ul></div>`;
  };

  return await branch(start, 0) ?? html`<div class=level></div>`;
}

export const cms = { node: { render } };
