import { hee } from "../core/lib/util.ts";
import type { App } from "../core/server.ts";
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.backend";
export const needs = ["cms"];

export const backend = {
    async checkInstalled(app: App): Promise<Node | undefined> {
        const cms = app.cms;
        let node = await cms.nodeByModule("cms.backend");
        if (!node) {
            const root = await cms.node(1);
            const P = await root.createChild({
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
        return node ? await node.page() : node;
    },
    async install(app: App, module: string): Promise<Node | undefined> {
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
        return node?.page();
    }
}

/**
 * cms.backend install()
 * Port of cms.backend/install.php
 */
export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.checkInstalled(app);
  if (P) {
    await P.title("en", "Backend");
  }
}

async function render(node: Node): Promise<string> {
  const page = await node.page();
  const children = [...(await page.children()).values()];
  const widgets: string[] = [];

  for (const child of children) {
    if (!child.vs.visible) continue;
    const cont = (await child.conts())[0];
    const widget = cont?.module?.exports.backendDashboardWidget;
    if (typeof widget !== "function") continue;
    try {
      const body = await widget(node.app);
      if (!body) continue;
      const url = hee(await child.url());
      const title = hee(await (await child.title()).string());
      widgets.push(`<div class="xc1-box u2-card"><a class="-head" href="${url}">${title}</a>${body}</div>`);
    } catch (e) { console.error(e) }
  }

  const widgetsHtml = widgets.length
    ? widgets.join("\n")
    : `<div class="u2-card"><div class="-body" style="color:#999">No widgets available.</div></div>`;

  return `<div class="u2-flex">${widgetsHtml}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
