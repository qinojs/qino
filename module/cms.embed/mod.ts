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
export async function sync(app: App, name = "cms"): Promise<{ texts: number; files: number; errors: string[] }> {
  const db = app.db, max = Number(await app.settings["cms.embed"].chunkChars) || 4000;
  const errors: string[] = [];
  const live = new Set<string>();
  let texts = 0, files = 0;
  const put = async (table: string, id: string, text: string) => {
    live.add(`${table}\0${id}`);
    const parts = chunks(text, max);
    const old = await db.col`SELECT part FROM ai1_embed_entry e JOIN ai1_embed_collection c ON c.id = e.collection_id
      WHERE c.name = ${name} AND e.table_name = ${table} AND e.row_id = ${id} AND e.part LIKE ${"text:%"}`;
    for (const part of old.map(String)) if (!parts.some((_, i) => part === `text:${i}`)) await remove(app, name, { table, id, part });
    for (const [i, part] of parts.entries()) {
      const ref = { table, id, part: `text:${i}` };
      try { await indexText(app, name, ref, part); }
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
  const old = await db.query`SELECT e.table_name, e.row_id, e.part FROM ai1_embed_entry e
    JOIN ai1_embed_collection c ON c.id = e.collection_id WHERE c.name = ${name} AND e.part LIKE ${"text:%"}`;
  for (const row of old) {
    const table = String(row.table_name), id = String(row.row_id);
    if (!live.has(`${table}\0${id}`)) await remove(app, name, { table, id, part: String(row.part) });
  }
  return { texts, files, errors };
}
