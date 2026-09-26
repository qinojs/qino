import { unhee } from "@qino/qino";
import { indexText, remove } from "@qino/qino/ai1.embed";

import type { App } from "@qino/qino";

/** Stable character chunks, cut at a word boundary where possible. */
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

/** Index page texts and extracted file text. Existing image vectors stay on their own `part`. */
export async function sync(app: App): Promise<{ texts: number; files: number; errors: string[] }> {
  const db = app.db, max = Number(await app.settings["cms.embed"].chunkChars) || 4000;
  const primary = String(await app.settings["ai1.embed"].primary || "");
  const selected = primary ? await db.row`SELECT * FROM ai1_embed_collection WHERE name = ${primary}` : undefined;
  const collection = selected || await db.row`SELECT * FROM ai1_embed_collection ORDER BY id LIMIT 1`;
  if (!collection) throw new Error("Create an embedding collection first");
  const selection = { model: String(collection.model), dimensions: Number(collection.dimensions) };
  const errors: string[] = [];
  const live = new Set<string>();
  let texts = 0, files = 0;
  const put = async (table: string, id: string, text: string) => {
    live.add(`${table}\0${id}`);
    const parts = chunks(text, max);
    const old = await db.col`SELECT part FROM ai1_embed_entry
      WHERE collection_id = ${collection.id} AND table_name = ${table} AND row_id = ${id} AND part LIKE ${"text:%"}`;
    for (const part of old.map(String)) if (!parts.some((_, i) => part === `text:${i}`)) await remove(app, { table, id, part }, selection);
    for (const [i, part] of parts.entries()) {
      const ref = { table, id, part: `text:${i}` };
      try { await indexText(app, ref, part, selection); }
      catch (e) { errors.push(`${table}/${id}/${i}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  };
  const pageTexts = await db.query`SELECT DISTINCT t.text_id, t.lang, t.text FROM text_lang t
    WHERE EXISTS (SELECT 1 FROM page_text pt WHERE pt.text_id = t.text_id)
       OR EXISTS (SELECT 1 FROM page p WHERE p.title_id = t.text_id)`;
  for (const row of pageTexts) {
    const text = unhee(String(row.text ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    await put("text_lang", `${row.text_id}:${row.lang}`, text);
    texts++;
  }
  const pageFiles = await db.query`SELECT DISTINCT f.id, f.text FROM file f JOIN page_file pf ON pf.file_id = f.id`;
  for (const row of pageFiles) {
    live.add(`file\0${row.id}`);
    let text = row.text;
    if (text == null) {
      try { text = await (await app.dbFiles.file(Number(row.id))).extractText(); }
      catch (e) { errors.push(`file/${row.id}: ${e instanceof Error ? e.message : String(e)}`); continue; }
    }
    await put("file", String(row.id), String(text ?? ""));
    files++;
  }
  const old = await db.query`SELECT table_name, row_id, part FROM ai1_embed_entry
    WHERE collection_id = ${collection.id} AND part LIKE ${"text:%"}`;
  for (const row of old) {
    const table = String(row.table_name), id = String(row.row_id);
    if (!live.has(`${table}\0${id}`)) await remove(app, { table, id, part: String(row.part) }, selection);
  }
  return { texts, files, errors };
}
