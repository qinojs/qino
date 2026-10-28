import type { App } from "@qino/qino";

/** table1 read a bare column width as percent, cms.cont.table reads it as px. Nodes that never set `units`
 *  relied on that default, so it gets written out before the rename. table2 already read px. The widths
 *  `row_N` become `width_N`. */
export async function migrateTable1(app: App): Promise<void> {
  const nodes = await app.db.query`SELECT id, module, settings FROM page WHERE module IN ('cms.cont.table1', 'cms.cont.table', 'cms.cont.table2')`;
  let changed = 0;
  for (const node of nodes) {
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(String(node.settings || "{}")); } catch { /* keep the empty defaults */ }
    const before = JSON.stringify(settings);
    if (node.module !== "cms.cont.table2") settings.units ||= "%";
    settings = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k.replace(/^row_(\d+)$/, "width_$1"), v]));
    const after = JSON.stringify(settings);
    if (after === before) continue;
    await app.db.exec`UPDATE page SET settings = ${after} WHERE id = ${node.id}`;
    changed++;
  }
  if (changed) console.log(`[migrate_from_php] tables: ${changed} nodes with their width unit and width_N`);
}
