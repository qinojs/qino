import { type Node } from "../cms/mod.ts";

export const name = "cms.cont.text";
export const needs = ["cms"];

async function render(node: Node) {
  const text = await node.showText("main");
  return `<div${node.edit ? ` contenteditable cmstxt=${text.id}` : ""}>${text}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
