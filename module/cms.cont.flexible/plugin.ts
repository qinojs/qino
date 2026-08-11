// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export const settingsSchema = {
  properties: {
    "init-child-module": { type: "string", description: "Module for the first automatically created child element when any flexible container is empty." },
  },
};

async function render(node: Node, { vars }: any = {}): Promise<string> {
  let conts = await node.conts();

  // Init a default child module once per node; deleting all children must not bring it back
  if (!conts.length && !node.settings.__inited()) {
    const defaultModule = await node.app.settings[name]["init-child-module"];
    const initModule = vars["init-child-module"] ?? defaultModule;
    if (initModule) {
      node.settings.__inited(true);
      await node.cont("init", initModule);
      conts = await node.conts();
    }
  }

  let str = "";
  for (const c of conts) str += await c.html();
  return `<div>${str}</div>`;
}

export const cms = {
  node: {
    render,
  },
};
