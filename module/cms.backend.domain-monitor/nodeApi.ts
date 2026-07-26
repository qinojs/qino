import type { Node } from "../cms/mod.ts";
import { rowsFor, runChecks, setFrequency, type DomainRow } from "./lib/monitor.ts";
import { rowHtml } from "./render.ts";

const rowResponse = (rows: DomainRow[]) => ({
  rows: Object.fromEntries(rows.map((row) => [row.domain, String(rowHtml(row))])),
});

// Row-level mutations return JSON so the client updates in place, keeping search/sort state.
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.delete) {
    await app.db.table("monitor_domain").delete(String(vars.delete));
    return { done: true };
  }
  if (vars.frequency) {
    const domain = String(vars.frequency);
    await setFrequency(app, domain, String(vars.value ?? ""));
    return rowResponse(await rowsFor(app, domain));
  }
  if (vars.expect) await app.db.table("monitor_domain").update(String(vars.expect), { expect: String(vars.value ?? "") });
  const scope = String(vars.check ?? vars.expect ?? "");
  if (!scope) return false;
  const rows = await rowsFor(app, scope);
  await runChecks(app, rows);
  return rowResponse(await rowsFor(app, rows.map((row) => row.domain).join(",")));
}
