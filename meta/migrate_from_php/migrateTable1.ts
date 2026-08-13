import type { App } from "@qino/qino";

/** table1 read a bare column width as percent, table2 reads it as px. Nodes that never set `units`
 *  relied on that default, so it gets written out before the rename. */
export async function migrateTable1(app: App): Promise<void> {
  const nodes = await app.db.query`SELECT id, settings FROM page WHERE module IN ('cms.cont.table1', 'cms.cont.table')`;
  let changed = 0;
  for (const node of nodes) {
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(String(node.settings || "{}")); } catch { /* keep the empty defaults */ }
    if (settings.units) continue;
    settings.units = "%";
    await app.db.query`UPDATE page SET settings = ${JSON.stringify(settings)} WHERE id = ${node.id}`;
    changed++;
  }
  if (changed) console.log(`[migrate_from_php] table1: ${changed} nodes keep percent column widths`);
}
