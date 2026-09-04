// deno-lint-ignore-file no-explicit-any
import manifest from "./manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const settingsSchema = {
  properties: {
    "init-child-module": { type: "string", description: "Module for the first automatically created child element when any flexible container is empty." },
  },
};

// What the shared list panel writes: per container, not site-wide like init-child-module above.
const nodeSettingsSchema = {
  properties: {
    "default module": {
      type: "string",
      default: "cms.cont.flexible",
      description: "Module of a new entry.",
    },
    "add position": {
      type: "string",
      enum: ["bottom", "top"],
      default: "bottom",
      description: "Where a new entry appears.",
    },
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
      // The container is born with the site's module; from here the panel's picker owns it.
      node.settings["default module"](initModule);
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
    settingsSchema: nodeSettingsSchema,
    widget: "pub/options.js",
  },
};
