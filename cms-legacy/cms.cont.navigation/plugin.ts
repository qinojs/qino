import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cmsCtx, type Node } from "../../module/cms/mod.ts";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const active = cmsCtx(ctx).mainNode;
  const startId = Number(await node.settings.startPage);
  let start = startId ? await node.cms.node(startId) : await node.page();
  const startLevel = Number(await node.settings.startLevel);
  if (startLevel) start = await active.parent(startLevel) ?? start;
  const invert = !!await node.settings.invertVisible;
  const maxLevel = Math.max(0, Number(await node.settings.level) || 0);
  const pathOnly = !!await node.settings.pathOnly;
  const preview = !!await node.settings.previewText;

  const branch = async (parent: Node, level: number): Promise<HtmlString | string> => {
    if (maxLevel && level >= maxLevel || pathOnly && level && !await active.in(parent)) return "";
    const children = [...(await parent.children("readable")).values()].filter((child) => !!child.vs.visible !== invert);
    if (!children.length) return "";
    const items: HtmlString[] = [];
    for (const child of children) {
      const page = await child.page();
      const classes = [`cmsLink${page.id}`, await active.in(page) ? "cmsInside" : "", active.id === page.id ? "cmsActive" : ""].filter(Boolean).join(" ");
      items.push(await html.async`<li class="${classes}">${node.cms.link(child)}
  ${preview ? html`<div>${child.showText("preview")}</div>` : ""}
  ${branch(child, level + 1)}</li>`);
    }
    return html`<ul class="cmsChilds${parent.id}">${html.join(items)}</ul>`;
  };

  return html`<nav>${await branch(start, 0)}</nav>`;
}

export const cms = { node: { render } };
