import { Access, NotFoundError, s } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { loadTemplate } from "./mod.ts";
import { layoutEditorLinks, mayEditLayout } from "./moduleTemplate.ts";
import { renderNodes } from "./render.ts";

import type { ApiTree, App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Editor links for the template files of the layout a node uses. Shared by every layout
  * module: they all put the same two files in the panel. */
export const api: ApiTree = {
  node: {
    ":node": {
      paramSchema: s.number(),
      resolve: async (id: number, ctx: Ctx) => {
        const node = await cms(ctx.app).node(id);
        if (!node.exists() || !node.module) throw new NotFoundError(`Node ${id} not found`);
        return node;
      },
      editors: {
        get: {
          description: "Links that open this layout's template files in the file editor.",
          access: Access.USER,
          guard: ({ node }: { node: Node }) => mayEditLayout(node),
          execute: ({ node }: { node: Node }) => layoutEditorLinks(node),
        },
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("node:render", async (e) => {
    const mod = e.node.module;
    if (!mod) return;
    const ast = await loadTemplate(new URL("template.html", mod.source));
    if (!ast) return; // no template.html — module renders itself
    e.render = (node: Node) => renderNodes(ast, node);
  }, { signal });
}
