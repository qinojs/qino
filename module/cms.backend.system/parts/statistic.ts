import { html, sql } from "@qino/qino";

import type { Db, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

type DbTableStat = { name: string; bytes: number };

export async function dbTableStats(db: Db): Promise<DbTableStat[]> {
  if (db.dialect === "postgres") return pgTableStats(db);
  if (db.dialect === "sqlite") return sqliteTableStats(db);
  return (await db.query`SHOW TABLE STATUS`).map((r) => ({
    name: String(r.Name ?? ""),
    bytes: Number(r.Data_length ?? 0) + Number(r.Index_length ?? 0),
  }));
}

async function pgTableStats(db: Db): Promise<DbTableStat[]> {
  const rows = await db.query`
    SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
    ORDER BY bytes DESC`;
  return rows.map((r) => ({ name: String(r.name), bytes: Number(r.bytes ?? 0) }));
}

async function sqliteTableStats(db: Db): Promise<DbTableStat[]> {
  const tables = await db.col<string>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
  if (!tables.length) return [];
  const stats = await db.indexCol`
    SELECT COALESCE(m.tbl_name, d.name) AS name, SUM(d.pgsize) AS bytes
    FROM dbstat d
      LEFT JOIN sqlite_master m ON m.name = d.name
    WHERE COALESCE(m.tbl_name, d.name) IN (${sql.join(tables.map((t) => sql`${t}`))})
    GROUP BY COALESCE(m.tbl_name, d.name)`.catch(() => new Map());
  return tables.map((name) => ({ name, bytes: Number(stats.get(name) ?? 0) }));
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      const full = dir + entry.name;
      total += entry.isDirectory
        ? await dirSize(full + "/")
        : (await Deno.stat(full).catch(() => null))?.size ?? 0;
    }
  } catch { /* skip */ }
  return total;
}

type TreeNode = { size: number; children: Record<string, TreeNode> };

async function dirTree(dir: string): Promise<Record<string, TreeNode>> {
  const tree: Record<string, TreeNode> = {};
  async function walk(dir: string, relPath: string): Promise<number> {
    let total = 0;
    try {
      for await (const entry of Deno.readDir(dir)) {
        const full = dir + entry.name;
        const rel  = relPath + entry.name;
        if (entry.isDirectory) {
          const size  = await walk(full + "/", rel + "/");
          const parts = rel.split("/").filter(Boolean);
          const p0    = parts[0];
          if (p0) {
            tree[p0] ??= { size: 0, children: {} };
            tree[p0].size += size;
            const p1 = parts[1];
            if (p1) {
              tree[p0].children[p1] ??= { size: 0, children: {} };
              tree[p0].children[p1].size += size;
            }
          }
          total += size;
        } else {
          total += (await Deno.stat(full).catch(() => null))?.size ?? 0;
        }
      }
    } catch { /* skip */ }
    return total;
  }
  await walk(dir, "");
  return tree;
}

export default async function summary(node: Node): Promise<HtmlString> {
  const db      = node.app.db;
  const dir = node.app.dir;

  const tables = await dbTableStats(db);
  let dbTotal = 0;
  for (const t of tables) dbTotal += t.bytes;

  const diskTotal = await dirSize(dir);
  const dfOut = await new Deno.Command("df", { args: ["-B1", "--output=avail", dir] }).output();
  const diskFree = Number(new TextDecoder().decode(dfOut.stdout).trim().split("\n").pop() ?? "0");

  return html`
<table class=u2-table style="width:auto;">
  <tr><td>DB Gesamt<td style="text-align:right"><u2-bytes>${dbTotal}</u2-bytes>
  <tr><td>Daten auf Disk<td style="text-align:right"><u2-bytes>${diskTotal}</u2-bytes>
  <tr><td>Freier Speicher<td style="text-align:right"><u2-bytes>${diskFree}</u2-bytes>
</table>
<div class=-body cms-part=statistic-details>
  <button data-load-part=statistic-details>Details</button>
</div>`;
}

export async function details(node: Node): Promise<HtmlString> {
  const db      = node.app.db;
  const dir = node.app.dir;

  const tree  = await dirTree(dir);
  const array = Object.entries(tree)
    .flatMap(([p0, parent]) => Object.entries(parent.children).map(([p1, item]) => [`${p0}/${p1}`, item.size] as [string, number]))
    .sort((a, b) => b[1] - a[1]);

  const folderRows = array.map(([folder, size]) =>
    html`<tr><td>${folder}<td style="text-align:right"><u2-bytes>${size}</u2-bytes>`
  );

  const tables = await dbTableStats(db);
  tables.sort((a, b) => b.bytes - a.bytes);
  const tableRows = tables.map((t) =>
    html`<tr><td>${t.name}<td style="text-align:right"><u2-bytes>${t.bytes}</u2-bytes>`
  );

  return html`
<h2>Ordner</h2>
<table class=u2-table style="width:auto"><tbody>${folderRows}</table>

<h2>DB-Tabellen</h2>
<table class=u2-table style="width:auto"><tbody>${tableRows}</table>`;
}
