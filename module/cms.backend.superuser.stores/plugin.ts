import { html, Redirect, type App, type HtmlString } from "../core/mod.ts";
import { cms as cmsOf, type Node } from "../cms/mod.ts";

const target = "cms.backend.superuser.module";

/** Compatibility for existing installations: hide an empty old page; old URLs redirect to Modules. */
export async function init(app: App): Promise<void> {
  const page = await (await cmsOf(app).nodeByModule("cms.backend.superuser.stores"))?.page();
  if (page && !(await page.children()).size) await page.set("visible", 0);
}

async function render(node: Node): Promise<HtmlString> {
  const page = await (await node.cms.nodeByModule(target))?.page();
  if (page) throw new Redirect(await page.url());
  return html``;
}

export const cms = { node: { render } };
