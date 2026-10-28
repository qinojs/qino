// deno-lint-ignore-file no-explicit-any
/* What the panel shows: the form, and whether it lets this block show its entries; and letting one
   entry through. The right is asked of the form the entry came from, not of the
   block that shows it: whoever may edit a form decides what of it becomes public. */
import { sql, tableRef } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { formOf, listedBy } from "./lib/source.ts";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: any): Promise<any> {
  vars ??= {}; // a post without body
  if ("status" in vars) return await status(node, vars.status === true ? 0 : Number(vars.status) || 0);
  if (!("release" in vars)) return false;
  const app = node.app;
  const id = Number(vars.release);
  const nodeId = await app.db.one`
    SELECT node_id FROM ${sql.id(tableRef("form_entry"))} WHERE id = ${id}`;
  if (!nodeId) return false;
  const form = await cms(app).node(Number(nodeId));
  if (!form.exists() || await form.access() < 2) return false;

  await app.db.table("form_entry").update(id, { released: vars.on ? 1 : 0 });
  return { ok: true };
}

/** The form this block shows (0 for none), its page's title, and whether it allows the block; with
 *  `candidate`, that node instead, if it is a form. */
async function status(node: Node, candidate: number) {
  const form = candidate ? await cms(node.app).node(candidate) : await formOf(node);
  if (form?.vs.module !== "cms.cont.form" || !await form.isReadable()) return { form: 0 };
  const page = await form.page();
  return { form: form.id, title: (await page.showTitle()).plain(), url: await page.url(), allowed: listedBy(form, node) };
}
