// deno-lint-ignore-file no-explicit-any
/* Adding and removing a field. Both go through the server so that the rule which turns a
   label into a name lives in one place — the panel used to carry a copy of it, and the two
   drifted apart once already. */
import { getCtx } from "@qino/qino";

import { fieldName } from "./mod.ts";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: any): Promise<any> {
  if (await node.access() < 2) return false; // writing a field is editing the form

  if (vars.add) {
    const label = String(vars.add).trim();
    if (!label) return { error: String(node.app.t`A field needs a label.`) };
    const name = fieldName(label);
    // `in`, not a read: item.js objects are autovivifying, so asking for the value would
    // create the very field the question is about.
    if (name in node.settings.fields) return { error: String(node.app.t`A field with this name already exists.`) };
    node.settings.fields[name]({});
    // The label is a text like any other, so it can be translated later.
    await node.text(name + "_title", getCtx().lang, label);
    return { name };
  }

  if (vars.remove) {
    const name = String(vars.remove);
    delete node.settings.fields[name];
    // Its texts have no owner left — the field is the only thing that named them.
    for (const suffix of ["_title", "_options", "_placeholder"]) await node.textDelete(name + suffix);
    return { name };
  }

  return false;
}
