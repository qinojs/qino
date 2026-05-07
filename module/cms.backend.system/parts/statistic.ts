/**
 * cms.backend.system/parts/statistic.ts
 * Port of cms.backend.system/parts/statistic.php
 */

// deno-lint-ignore-file no-explicit-any

import { hee } from "../../core/lib/util.ts";

export default async function render(node: any): Promise<string> {
  const db      = node.app.db;
  const appPATH = node.app.appPATH as string;

  // ── disk usage by folder ──────────────────────────────────────────────
  type TreeNode = { size: number; children: Record<string, TreeNode> };
  const tree: Record<string, TreeNode> = {};

  async function walk(dir: string, relPath: string): Promise<number> {
    let total = 0;
    try {
      for await (const entry of Deno.readDir(dir)) {
        const full = dir + entry.name;
        const rel  = relPath + entry.name;
        if (entry.isDirectory) {
          const size = await walk(full + "/", rel + "/");
          const parts = rel.split("/").filter(Boolean);
          if (parts.length >= 1) {
            const p0 = parts[0];
            if (!tree[p0]) tree[p0] = { size: 0, children: {} };
            tree[p0].size += size;
            if (parts.length >= 2) {
              const p1 = parts[1];
              if (!tree[p0].children[p1]) tree[p0].children[p1] = { size: 0, children: {} };
              tree[p0].children[p1].size += size;
            }
          }
          total += size;
        } else {
          const stat = await Deno.stat(full).catch(() => null);
          total += stat?.size ?? 0;
        }
      }
    } catch { /* skip unreadable dirs */ }
    return total;
  }

  await walk(appPATH, "");

  const array: Array<[string, number]> = [];
  for (const [pName, parent] of Object.entries(tree)) {
    for (const [name, item] of Object.entries(parent.children)) {
      array.push([pName + "/" + name, item.size]);
    }
  }
  array.sort((a, b) => b[1] - a[1]);

  let folderRows = "";
  for (const [folder, size] of array) {
    folderRows += `<tr><td>${hee(folder)}<td style="text-align:right">${(size / 1000).toFixed(1)} KB`;
  }

  // ── DB table sizes ────────────────────────────────────────────────────
  const tables = await db.all("SHOW TABLE STATUS");
  tables.sort((a: any, b: any) => {
    const sa = (a.Data_length ?? 0) + (a.Index_length ?? 0);
    const sb = (b.Data_length ?? 0) + (b.Index_length ?? 0);
    return sb - sa;
  });

  let tableRows = "";
  for (const t of tables) {
    const size = (t.Data_length ?? 0) + (t.Index_length ?? 0);
    tableRows += `<tr><td>${hee(t.Name)}<td style="text-align:right">${(size / 1000).toFixed(1)} KB`;
  }

  return `
<h2>Folders</h2>
<table class="c1-style" style="width:auto">
  <tbody>${folderRows}
</table>

<h2>DB-Tables</h2>
<table class="c1-style" style="width:auto">
  <tbody>${tableRows}
</table>`;
}
