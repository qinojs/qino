import { Access, AccessError, isFile, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";

import type { ApiTree, App, Ctx } from "@qino/qino";

const SETTINGS_FILE = "pub/settings.js";

export const api: ApiTree = {
  settings: {
    ":node": {
      paramSchema: s.number(),
      get: {
        description: "Resolve the settings widget of the module used by a node.",
        access: Access.USER,
        execute: async ({ node }: { node: number }, ctx: Ctx) => {
          const current = await cms(ctx.app).node(node);
          if (await current.access() < 2) throw new AccessError();
          const mod = current.module;
          if (!mod) return null;
          const exists = mod.dir
            ? await isFile(mod.dir + SETTINGS_FILE, ctx.dev)
            : mod.manifest.files?.includes(SETTINGS_FILE);
          return exists ? { src: mod.modUrl + SETTINGS_FILE } : null;
        },
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", async ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || await app.settings.cms.frontend !== "cms.frontend.3") return;

    const current = cmsCtx(ctx);
    const node = current.mainNode;
    if (!node || await node.access() < 2) return;

    const moduleUrl = ctx.req.moduleUrl;
    const html = ctx.res.html;
    const qino = html.jsData.qino ??= {};
    qino.cms = {
      ...(qino.cms ?? {}),
      nodeId: node.id,
      requestedNodeId: current.requestedNodeId,
      editmode: current.editmode,
    };

    html.styles.add(moduleUrl + "cms.frontend.3/pub/panel.css");
    html.scripts.add(moduleUrl + "cms.frontend.3/pub/init.js");
  }, { signal });
}
