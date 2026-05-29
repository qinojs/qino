// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.cont.flexible";

const settingsSchema = {
  properties: {
    "init-child-module": { type: "string", description: "Module name for the first automatically created child element when this flexible container is empty." },
  },
};

async function render(node: Node, { vars }: any = {}): Promise<string> {
  let conts = await node.conts();

  // If no children yet, optionally init a default child module
  if (conts.length === 0) {
    const defaultModule = node.settings["init-child-module"]();
    const initModule = vars["init-child-module"] ?? defaultModule;
    if (initModule) { await node.cont("init", initModule); conts = await node.conts(); }
  }

  let str = "";
  for (const C of conts) {
    str += await C.html();
  }
  return `<div>${str}</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
