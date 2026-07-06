import type { App } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

export const backend = {
  async checkInstalled(app: App): Promise<Node | undefined> {
    const cms = app.cms;
    let node = await cms.nodeByModule("cms.backend");
    if (!node) {
      const root = await cms.node(1);
      const P = await root.createChild({
        id: 100,
        visible: 0,
        module: "cms.layout.backend",
        access: 0,
        offline: 0,
        sort: 20,
        searchable: 0,
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
      node = await cms.nodeByModule("cms.backend");
    }
    return node?.page();
  },
  async install(app: App, module: string, titles?: Record<string, string>): Promise<Node | undefined> {
    const cms = app.cms;

    await backend.checkInstalled(app);
    const m = module.match(/^cms\.backend\.(.+)/);
    if (!m) return;
    const parts = m[1].split(".");
    let parentModule = "cms.backend";
    for (const part of parts) {
      const mod = parentModule + "." + part;
      const existing = await cms.nodeByModule(mod);
      if (!existing) {
        const parentNode = await cms.nodeByModule(parentModule);
        const Parent = parentNode ? await parentNode.page() : parentNode;
        if (Parent) {
          const Node = await (await Parent.createChild({
            module: "cms.layout.backend",
            visible: 1,
            access: 0,
            offline: 0,
          })).cont('1');
          await Node.set("module", mod);
        }
      }
      parentModule = mod;
    }
    const node = await cms.nodeByModule(module);
    const P = await node?.page();
    if (P && titles) for (const [lang, text] of Object.entries(titles)) await P.title(lang, text);
    return P;
  }
}
