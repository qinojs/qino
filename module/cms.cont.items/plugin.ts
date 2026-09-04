import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/**
 * A list of equal entries: cards, teasers, staff, opening hours. The block holds the children,
 * the children hold the content, and `default module` says what an entry is.
 *
 * The successor of the old `cms.cont.items2`, and the same idea: without the declaration an
 * editor faces the whole module list and has to guess which one belongs in this list. Here the
 * block already knows, so "Add entry" in the options panel asks nothing.
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
    widget: "pub/options.js",
    css: ["pub/main.css"],
  },
};
