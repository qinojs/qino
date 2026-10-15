// deno-lint-ignore-file no-explicit-any
/* Only the export lives here: it hands out a file rather than a piece of the page, which the
   part reload cannot do. Everything else the table writes goes through `list()`. */
import { cms } from "@qino/qino/cms";

import { csv } from "./render.ts";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: any): Promise<any> {
  if (!vars.export) return false;
  const form = await cms(node.app).node(Number(vars.export));
  if (!form.exists() || form.vs.module !== "cms.cont.form4" || await form.access() < 2) return false;
  return { name: `form-${form.id}.csv`, csv: await csv(node.app, form, String(vars.search ?? "")) };
}
