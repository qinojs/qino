// deno-lint-ignore-file no-explicit-any
import { sql } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { thinHistory, versedTables, versTable } from "../cms.versions/mod.ts";

export default async function (node: Node, vars: any): Promise<any> {
  if (await node.access() < 2) return false;
  const db = node.app.db;

  if ("thin" in vars) {
    return { done: true, deleted: await thinHistory(db) };
  }

  // Delete one non-live space (history + space rows).
  if ("deleteSpace" in vars) {
    const space = Number(vars.deleteSpace);
    if (!space) return false; // never the live space (0)
    for (const t of Object.keys(versedTables(db))) {
      const vt = await versTable(db, t);
      if (vt) await db.query`DELETE FROM ${sql.id(vt)} WHERE _vers_space = ${space}`;
    }
    await db.query`DELETE FROM vers_space WHERE space = ${space}`;
    await db.query`DELETE FROM vers_cms_page_changed WHERE space = ${space}`.catch(() => {});
    return { done: true };
  }

  // Nuclear reset: drop all history (live + spaces).
  if ("purge" in vars) {
    for (const t of Object.keys(versedTables(db))) {
      const vt = await versTable(db, t);
      if (vt) await db.query`DELETE FROM ${sql.id(vt)}`;
    }
    await db.query`DELETE FROM vers_space`;
    await db.query`DELETE FROM vers_cms_page_changed`.catch(() => {});
    return { done: true };
  }

  return false;
}
