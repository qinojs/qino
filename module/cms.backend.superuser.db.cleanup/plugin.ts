import { backend } from "../cms.backend/mod.ts";
import type { App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { findOrphans, schemaExtras } from "./lib/cleanup.ts";
import { nodeApi } from "./nodeApi.ts";
import { backendDashboardWidget, render, renderRow } from "./render.ts";

export const name = "cms.backend.superuser.db.cleanup";
export const needs = ["cms.backend.superuser.db"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Cleanup", de: "Aufräumen" });
}

export const cms = { node: { js: ["pub/main.js"], render, api } };

async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const result = await nodeApi(node, vars);
  if (result.error || result.remove) return result;
  const tables = result.tables ?? [];
  if (!tables.length) return result;
  const orphans = await findOrphans(node.app.db, tables.length === 1 ? tables[0] : undefined);
  const extras = schemaExtras(node.app.db);
  const rows = await Promise.all(tables.map(async (table) => [table, String(await renderRow(node, table, orphans, extras))] as const));
  return { ...result, rows: Object.fromEntries(rows) };
}

export { backendDashboardWidget };
