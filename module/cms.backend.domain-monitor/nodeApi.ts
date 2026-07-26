import type { Node } from "../cms/mod.ts";
import { rowsFor, runChecks, setFrequency, type DomainRow } from "./lib/monitor.ts";
import { rowHtml } from "./render.ts";

const rowResponse = (rows: DomainRow[]) => ({
  rows: Object.fromEntries(rows.map((row) => [row.domain, String(rowHtml(row))])),
});

// Every action takes a comma-separated selection; a single row is just a selection of one.
const domainList = (value: unknown) => String(value ?? "").split(",").filter(Boolean);

// Row-level mutations return JSON so the client updates in place, keeping search/sort state.
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.delete) {
    for (const domain of domainList(vars.delete)) await app.db.table("monitor_domain").delete(domain);
    return { done: true };
  }
  if (vars.frequency) {
    const domains = domainList(vars.frequency);
    await setFrequency(app, domains, String(vars.value ?? ""));
    return rowResponse(await rowsFor(app, domains));
  }
  if (vars.expect) await app.db.table("monitor_domain").update(String(vars.expect), { expect: String(vars.value ?? "") });
  const rows = await rowsFor(app, domainList(vars.check ?? vars.expect));
  if (!rows.length) return false;
  await runChecks(app, rows);
  return rowResponse(await rowsFor(app, rows.map((row) => row.domain)));
}
