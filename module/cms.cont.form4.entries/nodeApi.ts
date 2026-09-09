// deno-lint-ignore-file no-explicit-any
/* Letting one entry through. The right is asked of the form the entry came from, not of the
   block that shows it: whoever may edit a form decides what of it becomes public. */
import { sql, tableRef } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: any): Promise<any> {
  if (!("release" in vars)) return false;
  const app = node.app;
  const id = Number(vars.release);
  const nodeId = await app.db.one`
    SELECT node_id FROM ${sql.id(tableRef("form4_entry"))} WHERE id = ${id}`;
  if (!nodeId) return false;
  const form = await cms(app).node(Number(nodeId));
  if (!form.exists() || await form.access() < 2) return false;

  await app.db.table("form4_entry").update(id, { released: vars.on ? 1 : 0 });
  return { ok: true };
}
