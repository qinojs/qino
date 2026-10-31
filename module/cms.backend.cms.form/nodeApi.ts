// deno-lint-ignore-file no-explicit-any
/* Only the export lives here: it hands out a file rather than a piece of the page, which the
   part reload cannot do. Everything else the table writes goes through `list()`. */
import { csv, xlsx } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { exportRows } from "./render.ts";

import type { Node } from "@qino/qino/cms";

/** The file types an export comes in: Excel for people, CSV for machines. */
const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
};

export default async function (node: Node, vars: any): Promise<any> {
  if (!vars?.export) return false;
  const form = await cms(node.app).node(Number(vars.export));
  if (!form.exists() || form.vs.module !== "cms.cont.form" || await form.access() < 2) return false;
  const rows = await exportRows(node.app, form, String(vars.search ?? ""), !!vars.spam);
  const format = vars.format === "csv" ? "csv" : "xlsx";
  const bytes = format === "csv" ? new TextEncoder().encode(csv(rows)) : await xlsx(rows);
  return { name: `form-${form.id}.${format}`, type: TYPES[format], data: bytes.toBase64() };
}
