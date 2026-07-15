import { hee, sql, type Db } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

type DbTableStat = { name: string; bytes: number };

export async function dbTableStats(db: Db): Promise<DbTableStat[]> {
  if (db.dialect === "postgres") return pgTableStats(db);
  if (db.dialect === "sqlite") return sqliteTableStats(db);
  const rows = await db.query`SHOW TABLE STATUS`;
  return rows.map((r) => ({
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
  const tables = await db.col`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
  if (!tables.length) return [];
  const stats: Record<string, unknown> = await db.indexCol`
    SELECT COALESCE(m.tbl_name, d.name) AS name, SUM(d.pgsize) AS bytes
    FROM dbstat d
      LEFT JOIN sqlite_master m ON m.name = d.name
    WHERE COALESCE(m.tbl_name, d.name) IN (${sql.join(tables.map((t) => sql`${String(t)}`))})
    GROUP BY COALESCE(m.tbl_name, d.name)`.catch(() => ({}));
  return tables.map((name) => ({ name: String(name), bytes: Number(stats[String(name)] ?? 0) }));
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

async function dirTree(appPATH: string): Promise<Record<string, TreeNode>> {
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
  await walk(appPATH, "");
  return tree;
}

export default async function summary(node: Node): Promise<string> {
  const db      = node.app.db;
  const appPATH = node.app.appPATH;

  const tables = await dbTableStats(db);
  let dbTotal = 0;
  for (const t of tables) dbTotal += t.bytes;

  const diskTotal = await dirSize(appPATH);
  const dfOut = await new Deno.Command("df", { args: ["-B1", "--output=avail", appPATH] }).output();
  const diskFree = Number(new TextDecoder().decode(dfOut.stdout).trim().split("\n").pop() ?? "0");

  const loadBtn = `<button data-load-part="statistic-details">Details</button>`;

  return `
<table class="u2-table" style="width:auto;">
  <tr><td>DB Gesamt<td style="text-align:right"><u2-bytes>${dbTotal}</u2-bytes>
  <tr><td>Daten auf Disk<td style="text-align:right"><u2-bytes>${diskTotal}</u2-bytes>
  <tr><td>Freier Speicher<td style="text-align:right"><u2-bytes>${diskFree}</u2-bytes>
</table>
<div class="-body" cms-part="statistic-details">${loadBtn}</div>`;
}

export async function details(node: Node): Promise<string> {
  const db      = node.app.db;
  const appPATH = node.app.appPATH;

  const tree  = await dirTree(appPATH);
  const array = Object.entries(tree)
    .flatMap(([p0, parent]) => Object.entries(parent.children).map(([p1, item]) => [`${p0}/${p1}`, item.size] as [string, number]))
    .sort((a, b) => b[1] - a[1]);

  const folderRows = array.map(([folder, size]) =>
    `<tr><td>${hee(folder)}<td style="text-align:right"><u2-bytes>${size}</u2-bytes>`
  ).join("");

  const tables = await dbTableStats(db);
  tables.sort((a, b) => b.bytes - a.bytes);
  const tableRows = tables.map((t) =>
    `<tr><td>${hee(t.name)}<td style="text-align:right"><u2-bytes>${t.bytes}</u2-bytes>`
  ).join("");

  return `
<h2>Ordner</h2>
<table class="u2-table" style="width:auto"><tbody>${folderRows}</table>

<h2>DB-Tabellen</h2>
<table class="u2-table" style="width:auto"><tbody>${tableRows}</table>`;
}
