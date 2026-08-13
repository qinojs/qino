// deno-lint-ignore-file no-explicit-any
import { sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { thinHistory, versedTables, versTable } from "@qino/qino/cms.versions";

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
    await db.transaction(async () => {
      for (const t of Object.keys(versedTables(db))) {
        const vt = await versTable(db, t);
        if (vt) await db.exec`DELETE FROM ${sql.id(vt)} WHERE _vers_space = ${space}`;
      }
      await db.exec`DELETE FROM vers_space WHERE space = ${space}`;
    });
    return { done: true };
  }

  // Nuclear reset: drop all history (live + spaces).
  if ("purge" in vars) {
    await db.transaction(async () => {
      for (const t of Object.keys(versedTables(db))) {
        const vt = await versTable(db, t);
        if (vt) await db.exec`DELETE FROM ${sql.id(vt)}`;
      }
      await db.exec`DELETE FROM vers_space`;
    });
    return { done: true };
  }

  return false;
}
