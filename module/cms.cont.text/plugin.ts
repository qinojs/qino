import type { Node } from "../cms/mod.ts";

async function render(node: Node) {
  const text = await node.showText("main");
  return `<div${node.edit ? ` contenteditable cmstxt=${text.id}` : ""}>${text}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
