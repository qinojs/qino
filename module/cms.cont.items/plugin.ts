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
    width: {
      type: "string",
      enum: ["u2-width", ""],
      default: "u2-width",
      description: "u2-width: the site's content width, like items2 always did. Empty: as wide as whatever contains it.",
    },
  },
};

type SettingKey = keyof typeof settingsSchema.properties;
/** The schema is the only place a default is written down — panel and render read the same one. */
const declared = (key: SettingKey): string =>
  String((settingsSchema.properties[key] as { default?: string }).default ?? "");
/** What is stored, or undefined when the setting was never touched. */
const stored = (node: Node, key: SettingKey): string | undefined => {
  const value = node.settings[key]();
  return value == null ? undefined : String(value);
};

// `||` and `??` differ on purpose: an empty module means "not set", an empty width is the
// editor's choice to let the list run as wide as whatever contains it.
export const entryModule = (node: Node): string => stored(node, "default module") || declared("default module");

async function render(node: Node): Promise<HtmlString> {
  let conts = await node.conts();

  // An empty list has nothing to click on. The first entry is created for the editor, the way
  // items2 did it — but only in edit mode: a visitor's page view must not write to the database.
  if (!conts.length && node.edit) {
    // createChild clears the tree cache, so the fresh child is in the next read.
    await node.cont("first", { module: entryModule(node) });
    conts = await node.conts();
  }

  const width = stored(node, "width") ?? declared("width");
  const grid = html.async`<div class="u2-grid">${conts}</div>`;
  return width ? html.async`<div class="${width}">${grid}</div>` : grid;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    widget: "pub/options.js",
    css: ["pub/main.css"],
  },
};
