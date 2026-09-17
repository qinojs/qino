import { html, unixTime } from "@qino/qino";
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

/** Adds query params to a page url, "" staying "" — page urls are app-relative,
 *  the base only lets `URL` parse them. */
export function toUrl(url: string, params: Record<string, unknown> = {}): string {
  if (!url) return "";
  const u = new URL(url, "http://-");
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, String(value));
  return u.pathname + u.search;
}

/** Link builder for another backend module's page: `link({ id })` → "/path?id=…".
 *  "" when that page is missing or the user may not see it — every caller falls back to plain text,
 *  like the menu and the dashboard, which list only pages the user has access to. */
export async function toModuleUrl(node: Node, module: string): Promise<(params?: Record<string, unknown>) => string> {
  const page = await (await node.cms.nodeByModule(module))?.page();
  const url = page && await page.access() ? await page.url() : "";
  return (params) => toUrl(url, params);
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

const OS_TESTS: [string, RegExp][] = [
  ["Windows", /Windows/],
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["ChromeOS", /CrOS/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Linux", /Linux/],
];

/** Deterministic color for any value, to tell clients, IPs, users … apart at a glance. */
export function uniqueColor(v: unknown): string {
  const s = String(v ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

/** Freshness color for a unix time: green → orange (2 min) → text color (10 min), "" when older. */
export function ageColor(time: unknown, now = unixTime()): string {
  const min = Math.max(0, now - Number(time)) / 60;
  if (!(min < 10)) return "";
  const pct = (f: number) => Math.round(f * 100);
  return min < 2
    ? `color-mix(in oklch, var(--orange) ${pct(min / 2)}%, var(--green))`
    : `color-mix(in oklch, currentColor ${pct((min - 2) / 8)}%, var(--orange))`;
}

/** Lightweight user-agent classification (browser + version, OS, mobile and bot flags). */
export function uaInfo(ua: string): { browser: string; version: string; os: string; mobile: boolean; bot: boolean } {
  const bot = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternal|headless|preview|monitor/i.test(ua);
  const os = OS_TESTS.find(([, re]) => re.test(ua))?.[0] ?? "";
  const mobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
  const [browser, m] = UA_TESTS.map(([name, re]) => [name, re.exec(ua)] as const).find(([, m]) => m) ?? [ua ? "?" : "-", null];
  return { browser, version: m?.[1] ?? "", os, mobile, bot };
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
