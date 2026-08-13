import { html } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Filter dates arrive as unix seconds (converted in the browser, where the TZ is
// known); fall back to parsing a raw datetime string for direct API calls.
export const toUnix = (v: string): number => {
  if (/^\d+$/.test(v)) return Number(v);
  const ms = Date.parse(v);
  return isNaN(ms) ? 0 : Math.floor(ms / 1000);
};

export async function checkInstalled(app: App): Promise<Node | undefined> {
  const cm = cms(app);
  let node = await cm.nodeByModule("cms.backend");
  if (!node) {
    const root = await cm.node(1);
    const page = await root.createChild({
      id: 100,
      module: "cms.layout.backend",
      access: 0,
      offline: 0,
      visible: false,
      searchable: false,
      sort: 20,
    });
    if (page) {
      await page.changeGroup(1, 0);
      await page.changeGroup(2, 0);
      await page.changeGroup(3, 0);
      const c = await page.cont('1');
      await c.set("module", "cms.backend");
      page.settings.childXML = '<page visible=1></page>';
      app.settings.cms.backend(String(page.id));
    }
    node = await cm.nodeByModule("cms.backend");
  }
  return node?.page();
}

export async function install(app: App, module: string, titles?: Record<string, string>): Promise<Node | undefined> {
  const cm = cms(app);

  await checkInstalled(app);
  const m = module.match(/^cms\.backend\.(.+)/);
  if (!m) return;
  const parts = m[1].split(".");
  let parentModule = "cms.backend";
  for (const part of parts) {
    const mod = parentModule + "." + part;
    const existing = await cm.nodeByModule(mod);
    if (!existing) {
      const parentNode = await cm.nodeByModule(parentModule);
      const parent = parentNode ? await parentNode.page() : parentNode;
      if (parent) {
        const cont = await (await parent.createChild({
          module: "cms.layout.backend",
          access: 0,
          offline: 0,
          visible: true,
        })).cont('1');
        await cont.set("module", mod);
      }
    }
    parentModule = mod;
  }
  const node = await cm.nodeByModule(module);
  const p = await node?.page();
  if (p && titles) for (const [lang, text] of Object.entries(titles)) await p.title(lang, text);
  return p;
}

/** Remove the backend page install() created — the counterpart every cms.backend.* module needs.
 *  A page that still carries sub-pages stays: those belong to other modules that are installed. */
export async function uninstall(app: App, module: string): Promise<void> {
  const cm = cms(app);
  const page = await (await cm.nodeByModule(module))?.page();
  if (!page || (await page.children()).size) return;
  const parent = await page.parent();
  await parent?.removeChild(page);
}

const UA_TESTS: [string, RegExp][] = [
  ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
  ["Samsung", /SamsungBrowser\/([\d.]+)/],
  ["Firefox", /Firefox\/([\d.]+)/],
  ["Chrome", /Chrome\/([\d.]+)/],
  ["Safari", /Version\/([\d.]+).*Safari/],
];

/** Lightweight user-agent classification (browser name + version, bot flag). */
export function uaInfo(ua: string): { browser: string; version: string; bot: boolean } {
  const bot = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternal|headless|preview|monitor/i.test(ua);
  for (const [browser, re] of UA_TESTS) {
    const m = re.exec(ua);
    if (m) return { browser, version: m[1], bot };
  }
  return { browser: ua ? "?" : "-", version: "", bot };
}

// Linked breadcrumb from the tree root down to a node (a page or a content
// within it). Pass a `titles` map to cache ancestors across many breadcrumbs.
// Contents usually have no title, so fall back to their (shortened) module name,
// then the id.
export async function breadcrumb(host: Node, nodeId: number, titles: Map<number, string> = new Map()): Promise<HtmlString> {
  const node = await host.cms.node(nodeId);
  const nodes = [...(await node.path()).values()].filter((n) => n.id !== 1); // drop system root
  // the containing page is the deepest type='p' node; contents hang below it → show it in bold
  let pageIdx = -1;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].vs?.type === "p") pageIdx = i;
  const crumbs = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const title = (await nodeTitle(n, titles)) || String(n.vs?.module ?? "").replace(/^cms\.\w+\./, "") || `#${n.id}`;
    let url = "";
    try { url = await n.url(); } catch { /* no url (e.g. detached) */ }
    crumbs.push(html`<a href="${url}">${i === pageIdx ? html`<b>${title}</b>` : title}</a>`);
  }
  if (!crumbs.length) crumbs.push(html`<span>#${nodeId}</span>`);
  return html.join(crumbs, ' <span class=-sep>›</span> ');
}

async function nodeTitle(n: Node, cache: Map<number, string>): Promise<string> {
  const hit = cache.get(n.id);
  if (hit !== undefined) return hit;
  const s = (await (await n.title()).string()).trim();
  cache.set(n.id, s);
  return s;
}
