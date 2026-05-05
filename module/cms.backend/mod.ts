/**
 * cms.backend/mod.ts - Backend module welcome page
 * Port of cms.backend/index.php
 */

import type { App } from "@qino/qino";

// deno-lint-ignore-file no-explicit-any

export const name = "cms.backend";
export const needs = ["cms"];


export const backend = {
    async checkInstalled(app: App): Promise<any> {
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
    async install(app: App, module: string): Promise<any> {
        const cms = app.cms;

        await backend.checkInstalled(app);
        const m = module.match(/^cms\.backend\.(.+)/);
        if (!m) return false;
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
                    })).cont(1);
                    await Node.set("module", mod);
                }
            }
            parentModule = mod;
        }
        const node = await cms.nodeByModule(module);
        return await node?.page();
    }
}

/**
 * cms.backend install()
 * Port of cms.backend/install.php
 */
export async function install({app}: any): Promise<void> {
  const P = await backend.checkInstalled(app);
  if (P) {
    await P.title("en", "Backend");
    await P.title("de", "Backend");
  }
}

function render(): string {
  return `
  <div class="c1-box">
    <div class="-head">Willkommen</div>
    <div class="-body">Nutzen Sie die Navigation.</div>
  </div>`;
}

export const cms = {
  node: {
    render,
  },
};
