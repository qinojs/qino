import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/**
 * A list of similar entries: cards, teasers, staff, opening hours. `default module` defines the
 * entry type, so "Add entry" needs no module picker. Successor of `cms.cont.items2`.
 */

const settingsSchema = {
  properties: {
    "default module": {
      type: "string",
      default: "cms.cont.flexible",
      description: "Module of a new entry. cms.cont.flexible holds anything; a purpose-built module keeps the list uniform.",
    },
    "add position": {
      type: "string",
      enum: ["bottom", "top"],
      default: "bottom",
      description: "Where a new entry appears. A menu grows at the end, a list of news at the beginning.",
    },
  },
};

async function render(node: Node): Promise<HtmlString> {
  let conts = await node.conts();

  if (!conts.length && await node.edit()) { // Seed editable lists; cont() invalidates the cached children.
    await node.cont("first", { module: node.settings["default module"]() });
    conts = await node.conts();
  }

  return html.async`<div class="u2-grid">${conts}</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    widget: "pub/widget.js",
    css: ["pub/main.css"],
  },
};
