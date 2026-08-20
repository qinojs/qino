// What the demo run wrote — the reason it can be removed again without touching anything else.
//
// Rather than every seeder remembering its own rows, the run listens to the database: while it is
// active, each insert made *inside its async context* is noted with table and entry id. Requests
// running in parallel have another context and stay out of it, and a seeder gets the whole tree an
// api like `Node.createChild()` writes for free.
import { AsyncLocalStorage } from "node:async_hooks";

import type { App, Db } from "@qino/qino";

/** Rows in insert order, `[table, entry id]`. */
export type Rows = [string, string][];

/** Shared dictionaries and registries: rows a demo run may create but never owns. */
const NEVER = new Set(["qg_setting", "log_url", "log_ip", "log_user_agent", "smalltext", "score_scope", "module", "store"]);

const running = new AsyncLocalStorage<Rows>();

/** Run `fn`, collecting every row it inserts. */
export async function record<T>(db: Db, rows: Rows, fn: () => Promise<T>): Promise<T> {
  const off = new AbortController();
  db.on("table:insert-after", ({ table, id }) => {
    if (running.getStore() !== rows || id == null) return;
    const name = String(table);
    if (!NEVER.has(name)) rows.push([name, String(id)]);
  }, { signal: off.signal });
  try {
    return await running.run(rows, fn);
  } finally {
    off.abort();
  }
}

/** Delete recorded rows, newest first. Rows already gone (a cascade got there first) are skipped. */
export async function drop(app: App, rows: Rows): Promise<number> {
  let gone = 0;
  for (const [table, id] of rows.toReversed()) {
    if (!app.db.tables[table]) continue;
    try {
      // a file row owns a blob on disk, so it goes through the file manager
      if (table === "file") await (await app.dbFiles.file(id)).remove();
      else if (!await app.db.table(table).delete(id)) continue;
      gone++;
    } catch (e) {
      console.warn(`[demo] could not remove ${table}#${id}:`, (e as Error).message);
    }
  }
  return gone;
}

const MODULE = "cms.backend.demo";
const path = (app: App) => (app.modules.get(MODULE)?.data ?? `${app.dir}data/${MODULE}/`) + "seed.json";

export type Ledger = { time: number; rows: Rows; counts: Record<string, number>; root?: number };

/** The ledger of the last run — an empty one when the app was never seeded. */
export async function read(app: App): Promise<Ledger> {
  const json = await Deno.readTextFile(path(app)).catch(() => "");
  const data = json ? JSON.parse(json) : null;
  return { time: 0, rows: [], counts: {}, ...data };
}

export async function write(app: App, data: Ledger): Promise<void> {
  const file = path(app);
  await Deno.mkdir(file.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeTextFile(file, JSON.stringify(data));
}

export const forget = (app: App): Promise<void> => Deno.remove(path(app)).catch(() => {});
