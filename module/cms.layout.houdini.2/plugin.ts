import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// The renderer resolves templates, files, contents and settings from the node's own module.
export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    widget: "pub/widget.js",
    render: (node: Node, options: { ctx: Ctx }) =>
      node.app.modules.get("cms.layout.houdini")!.plugin.cms.node.render(node, options),
    api: (node: Node, vars: Record<string, unknown>) =>
      node.app.modules.get("cms.layout.houdini")!.plugin.cms.node.api(node, vars),
  },
};
