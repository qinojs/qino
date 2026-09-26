import { unhee } from "@qino/qino";

import { indexText, remove } from "../mod.ts";

import type { App } from "@qino/qino";

const TABLES = new Set(["text_lang", "file"]);

function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + max, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > at + max / 2) end = space;
    }
    out.push(text.slice(at, end).trim());
    at = end;
  }
  return out.filter(Boolean);
}

/** Index one generic text or file row. Image vectors use other parts and remain untouched. */
export async function indexRow(app: App, table: string, id: string, name = "main"): Promise<void> {
  if (!TABLES.has(table)) return;
  const db = app.db, row = await db.table(table).selectByID(id);
  let value = row?.text;
  if (table === "file" && row && value == null) value = await (await app.dbFiles.file(Number(id))).extractText();
  const text = unhee(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const max = Number(await app.settings["ai1.embed"].chunkChars) || 4000;
  const parts = chunks(text, max);
  const old = await db.col`SELECT e.part FROM ai1_embed_entry e JOIN ai1_embed_collection c ON c.id = e.collection_id
    WHERE c.name = ${name} AND e.table_name = ${table} AND e.row_id = ${id} AND e.part LIKE ${"text:%"}`;
  for (const part of old.map(String)) if (!parts.some((_, i) => part === `text:${i}`)) await remove(app, name, { table, id, part });
  for (const [i, part] of parts.entries()) await indexText(app, name, { table, id, part: `text:${i}` }, part);
}

/** Reconcile generic text and file rows, including writes that bypassed table events. */
export async function sync(app: App, name = "main"): Promise<{ texts: number; files: number; errors: string[] }> {
  const db = app.db, live = new Set<string>(), errors: string[] = [];
  let texts = 0, files = 0;
  for (const table of TABLES) {
    const rows = table === "text_lang"
      ? await db.query`SELECT text_id, lang FROM text_lang`
      : await db.query`SELECT id FROM file`;
    for (const row of rows) {
      const id = db.table(table).entryId(row);
      if (!id) continue;
      live.add(`${table}\0${id}`);
      try { await indexRow(app, table, id, name); }
      catch (e) { errors.push(`${table}/${id}: ${e instanceof Error ? e.message : String(e)}`); }
      if (table === "text_lang") texts++;
      else files++;
    }
  }
  const old = await db.query`SELECT e.table_name, e.row_id, e.part FROM ai1_embed_entry e
    JOIN ai1_embed_collection c ON c.id = e.collection_id WHERE c.name = ${name} AND e.part LIKE ${"text:%"}`;
  for (const row of old) {
    const table = String(row.table_name), id = String(row.row_id);
    if (TABLES.has(table) && !live.has(`${table}\0${id}`)) await remove(app, name, { table, id, part: String(row.part) });
  }
  return { texts, files, errors };
}
