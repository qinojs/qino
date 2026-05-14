// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.cont.flexible";

const settingsSchema = {
  properties: {
    "init-child-module": { type: "string", description: "Modulname fuer das erste automatisch erzeugte Kind-Element, wenn dieser flexible Container noch leer ist." },
  },
};

async function render(node: Node, { vars }: any = {}): Promise<string> {
  const conts = await node.conts();

  // If no children yet, optionally init a default child module
  if (Object.keys(conts).length === 0) {
    const defaultModule = node.settings["init-child-module"]();
    const initModule = vars["init-child-module"] ?? defaultModule;
    if (initModule) await node.cont("init", initModule);
  }

  let str = "";
  for (const C of Object.values(await node.conts())) {
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
