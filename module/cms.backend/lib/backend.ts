import type { App } from "../../core/mod.ts";
import { cms, type Node } from "../../cms/mod.ts";

export async function checkInstalled(app: App): Promise<Node | undefined> {
  const cm = cms(app);
  let node = await cm.nodeByModule("cms.backend");
  if (!node) {
    const root = await cm.node(1);
    const P = await root.createChild({
      id: 100,
      module: "cms.layout.backend",
      access: 0,
      offline: 0,
      visible: false,
      searchable: false,
      sort: 20,
    });
    if (P) {
      await P.changeGroup(1, 0);
      await P.changeGroup(2, 0);
      await P.changeGroup(3, 0);
      const cont = await P.cont('1');
      await cont.set("module", "cms.backend");
      P.settings.childXML = '<page visible="1"></page>';
      app.settings.cms.backend(String(P.id));
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
      const Parent = parentNode ? await parentNode.page() : parentNode;
      if (Parent) {
        const Node = await (await Parent.createChild({
          module: "cms.layout.backend",
          access: 0,
          offline: 0,
          visible: true,
        })).cont('1');
        await Node.set("module", mod);
      }
    }
    parentModule = mod;
  }
  const node = await cm.nodeByModule(module);
  const P = await node?.page();
  if (P && titles) for (const [lang, text] of Object.entries(titles)) await P.title(lang, text);
  return P;
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
