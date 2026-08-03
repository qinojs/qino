import type { Node } from "../cms/mod.ts";
import { rowsFor, runChecks, setFrequency, type DomainRow } from "./lib/monitor.ts";
import { rowHtml } from "./render.ts";

// The rows are swapped into a page this request never saw, so the caller sends its own query string
// along — the detail links have to keep the page's cmspid and lang.
const rowResponse = (rows: DomainRow[], page: unknown) => {
  const params = new URLSearchParams(String(page ?? ""));
  return { rows: Object.fromEntries(rows.map((row) => [row.domain, String(rowHtml(row, params))])) };
};

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
    return rowResponse(await rowsFor(app, domains), vars.page);
  }
  if (vars.expect) await app.db.table("monitor_domain").update(String(vars.expect), { expect: String(vars.value ?? "") });
  const rows = await rowsFor(app, domainList(vars.check ?? vars.expect));
  if (!rows.length) return false;
  await runChecks(app, rows);
  return rowResponse(await rowsFor(app, rows.map((row) => row.domain)), vars.page);
}
