import { cms } from "@qino/qino/cms";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** One text per language: `{ en: "Contact", de: "Kontakt" }`. */
export type Texts = Record<string, string>;

/**
 * Hands a starter's modules over to the site: each becomes an installed module of its own, so it
 * stays when the starter goes and can be uninstalled one by one. Other starters stay dependencies.
 */
export async function adopt(app: App, starter: string): Promise<void> {
  for (const name of app.modules.get(starter)?.dependencies ?? []) {
    const mod = app.modules.get(name);
    if (mod && !name.startsWith("starter.")) await app.modules.install(mod.source, name);
  }
}

/**
 * The page of that name, created below `parent` when there is none — so applying a starter again
 * fills gaps instead of doubling pages. `fill` runs only for a new page.
 */
export async function page(
  parent: Node, name: string, titles: Texts, fields: Record<string, unknown> = {},
  fill?: (page: Node) => unknown,
): Promise<Node> {
  const found = (await cms(parent.app).nodesByName(name)).values().find((node) => node.vs.type === "p");
  if (found) return found;
  const node = await parent.createChild({ name, ...fields });
  await title(node, titles);
  await fill?.(node);
  return node;
}

/** Moves `node` in front of its sibling of that name; at the end without a name or sibling. */
export async function before(node: Node, name?: string): Promise<void> {
  const parent = await node.parent();
  if (!parent) return;
  const siblings = await parent.children({ type: node.vs.type });
  const sibling = name ? siblings.values().find((child) => child.vs.name === name) : undefined;
  await parent.insertBefore(node, sibling);
}

export async function title(node: Node, titles: Texts): Promise<void> {
  for (const [lang, value] of Object.entries(titles)) await node.title(lang, value);
}

export async function text(node: Node, name: string, texts: Texts): Promise<void> {
  for (const [lang, value] of Object.entries(texts)) await node.text(name, lang, value);
}

/** A new section at the end of the page's main, holding one content of `module` — the shape a
 *  page of cms.layout.standard.2 starts with. */
export async function section(page: Node, module = "cms.cont.text"): Promise<Node> {
  const main = await page.cont("main", "cms.cont.flexible");
  await main.settings.__inited(true); // the flexible would add a starter of its own
  const section = await main.createCont({ module: "cms.cont.section" });
  return section.cont("main", module);
}

/** A section with a text in it. */
export async function prose(page: Node, texts: Texts): Promise<Node> {
  const node = await section(page);
  await text(node, "main", texts);
  return node;
}

/** Points `request` (a path without language, "" for the start page) at the page, unless taken. */
export async function redirect(app: App, request: string, page: Node): Promise<void> {
  if (await app.db.one`SELECT 1 FROM page_redirect WHERE request = ${request}`) return;
  await app.db.table("page_redirect").insert({ request, redirect: String(page.id) });
}

/** Internal link, resolved to the page's current url when rendered. */
export const link = (page: Node, label: string): string => `<a href="cmspid://${page.id}">${label}</a>`;

/** Link to the page that holds a content of `module` — a backend page, say. Without one, the label. */
export async function moduleLink(app: App, module: string, label: string): Promise<string> {
  const node = await cms(app).nodeByModule(module);
  return node ? link(await node.page(), label) : label;
}

/** Adds an item to the editors' checklist "First steps" of starter.cms, once per name. */
export async function todo(app: App, name: string, texts: Texts): Promise<void> {
  const cm = cms(app);
  const list = (await cm.nodesByName("first-steps")).values().find((node) => node.vs.type === "p");
  if (!list || (await cm.nodesByName(name)).size) return;
  // the name goes on the section: the template looks up its text as "main"
  await (await (await prose(list, texts)).parent())!.set("name", name);
}
