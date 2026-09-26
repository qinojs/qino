import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "npm:sqlite-vec@0.1.8";

import type { App } from "@qino/qino";

type Group = { id: number; dimensions: number; revision: number };
const table = (id: number) => `vec_${id}`; // id comes from the database, never from input
const blob = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
const WORK = Symbol("ai1.embed index work");

function serial<T>(app: App, work: () => Promise<T>): Promise<T> {
  const mod = app.modules.linked("ai1.embed") as { [WORK]?: Promise<void> } | undefined;
  if (!mod) throw new Error('Module "ai1.embed" is not loaded');
  const task = (mod[WORK] ?? Promise.resolve()).then(work, work);
  mod[WORK] = task.then(() => {}, () => {});
  return task;
}

async function open(app: App): Promise<DatabaseSync> {
  const dir = app.modules.linked("ai1.embed")?.cache;
  if (!dir) throw new Error('Module "ai1.embed" is not loaded');
  await Deno.mkdir(dir, { recursive: true });
  const db = new DatabaseSync(dir + "vectors.sqlite", { allowExtension: true });
  sqliteVec.load(db);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS revision (collection_id INTEGER PRIMARY KEY, value INTEGER)");
  return db;
}

/** Update an existing index after one SQL row changed; absent/stale caches rebuild on search. */
async function change(app: App, group: Group, id: number, values: number[], source: string): Promise<void> {
  const db = await open(app);
  try {
    const cached = db.prepare("SELECT value FROM revision WHERE collection_id = ?").get(group.id) as { value: number } | undefined;
    if (Number(cached?.value) !== Number(group.revision) - 1) return;
    const name = table(group.id);
    db.exec("BEGIN");
    try {
      db.prepare(`DELETE FROM ${name} WHERE rowid = ?`).run(BigInt(id));
      db.prepare(`INSERT INTO ${name}(rowid, embedding, table_name) VALUES (?, ?, ?)`).run(BigInt(id), blob(values), source);
      db.prepare("UPDATE revision SET value = ? WHERE collection_id = ?").run(group.revision, group.id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  } finally { db.close(); }
}
export const changed = (app: App, group: Group, id: number, values: number[], source: string): Promise<void> =>
  serial(app, () => change(app, group, id, values, source));

/** The SQL database is canonical; rebuild the local vector index after a missing or stale cache. */
async function match(app: App, group: Group, values: number[], limit: number, source?: string): Promise<{ id: number; score: number }[]> {
  const db = await open(app);
  const name = table(group.id);
  try {
    const cached = db.prepare("SELECT value FROM revision WHERE collection_id = ?").get(group.id) as { value: number } | undefined;
    if (Number(cached?.value) !== Number(group.revision)) {
      db.exec("BEGIN");
      try {
        db.exec(`DROP TABLE IF EXISTS ${name}`);
        db.exec(`CREATE VIRTUAL TABLE ${name} USING vec0(embedding float[${Number(group.dimensions)}] distance_metric=cosine, table_name text)`);
        const insert = db.prepare(`INSERT INTO ${name}(rowid, embedding, table_name) VALUES (?, ?, ?)`);
        let after = 0;
        for (;;) {
          const rows = await app.db.query`
            SELECT id, table_name, vector FROM ai1_embed_entry WHERE collection_id = ${group.id} AND id > ${after} ORDER BY id LIMIT 500`;
          if (!rows.length) break;
          for (const row of rows) insert.run(BigInt(String(row.id)), blob(JSON.parse(String(row.vector))), String(row.table_name));
          after = Number(rows.at(-1)!.id);
        }
        db.prepare("INSERT OR REPLACE INTO revision(collection_id, value) VALUES (?, ?)").run(group.id, group.revision);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    const where = source ? "AND table_name = ?" : "";
    const rows = db.prepare(`SELECT rowid, distance FROM ${name} WHERE embedding MATCH ? ${where} ORDER BY distance LIMIT ?`)
      .all(blob(values), ...(source ? [source] : []), limit) as { rowid: number; distance: number }[];
    return rows.map((row) => ({ id: Number(row.rowid), score: 1 - Number(row.distance) }));
  } finally { db.close(); }
}
export const matches = (app: App, group: Group, values: number[], limit: number, source?: string): Promise<{ id: number; score: number }[]> =>
  serial(app, () => match(app, group, values, limit, source));
