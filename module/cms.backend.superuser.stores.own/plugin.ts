import { html, Redirect, type App, type HtmlString } from "../core/mod.ts";
import { cms as cmsOf, type Node } from "../cms/mod.ts";

const current = "cms.backend.superuser.module.ownStore";
const legacy = "cms.backend.superuser.stores.own";

/** Compatibility for existing installations: hide the old page and its empty parent. */
export async function init(app: App): Promise<void> {
  const page = await (await cmsOf(app).nodeByModule(legacy))?.page();
  if (!page) return;
  await page.set("visible", 0);
  const parent = await page.parent();
  if (parent && [...(await parent.children()).values()].every((child) => !child.vs.visible)) await parent.set("visible", 0);
}

async function render(node: Node): Promise<HtmlString> {
  const page = await (await node.cms.nodeByModule(current))?.page();
  if (page) throw new Redirect(await page.url());
  return html``;
}

export const cms = { node: { render } };
