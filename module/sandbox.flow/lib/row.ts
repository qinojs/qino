// deno-lint-ignore-file no-explicit-any
import type { Flow } from "../mod.ts";

/** A row of the table `flow` as a flow to listen with or run. */
export const toFlow = (row: Record<string, any>): Flow => ({
  description: String(row.description ?? ""),
  on: { host: String(row.host), event: String(row.event) },
  owner: Number(row.usr_id),
  tools: JSON.parse(row.tools || "[]"),
  test: Boolean(row.test),
  code: String(row.code ?? ""),
});
