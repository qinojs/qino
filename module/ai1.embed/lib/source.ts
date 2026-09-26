import { unhee } from "@qino/qino";

import { indexImage, indexText, remove } from "../mod.ts";
import { group } from "./group.ts";

import type { App } from "@qino/qino";
import type { Group, Selection } from "./group.ts";

const TABLES = new Set(["text_lang", "file"]);

async function imageRow(app: App, id: string, row: Record<string, unknown> | undefined, selected: Group): Promise<void> {
  const old = (await app.db.col`SELECT part FROM ai1_embed_entry WHERE collection_id = ${selected.id}
    AND table_name = ${"file"} AND row_id = ${id} AND part LIKE ${"image:%"}`).map(String);
  const md5 = String(row?.md5 ?? "");
  const file = md5 && String(row?.mime).startsWith("image/") ? await app.dbFiles.file(Number(id)) : undefined;
  if (file) await file.reload();
  const part = file && await file.exists() ? `image:${md5}` : "";
  const selection = { model: selected.model, dimensions: selected.dimensions };
  const vision = part && await app.db.one`SELECT 1 FROM ai1_model_capability c JOIN ai1_model m ON m.id = c.model_id
    WHERE m.name = ${selected.model} AND c.capability = ${"vision"}`;
  if (file && vision && !old.includes(part)) {
    const image = `data:${file.mime};base64,${(await Deno.readFile(file.path)).toBase64()}`;
    await indexImage(app, { table: "file", id, part }, image, selection);
  }
  for (const previous of old) if (previous !== part) await remove(app, { table: "file", id, part: previous }, selection);
}

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

/** Index one generic text or file row, including image bytes when supported. */
export async function indexRow(app: App, table: string, id: string, selection: Selection = {}): Promise<void> {
  if (!TABLES.has(table)) return;
  const selected = await group(app, selection);
  if (!selected) return;
  const db = app.db, row = await db.table(table).selectByID(id);
  const imageError = table === "file" ? await imageRow(app, id, row, selected).catch((e) => e) : undefined;
  let value = row?.text;
  if (table === "file" && row && value == null) value = await (await app.dbFiles.file(Number(id))).extractText();
  const text = unhee(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const max = Number(await app.settings["ai1.embed"].chunkChars) || 4000;
  const parts = chunks(text, max);
  const old = await db.col`SELECT part FROM ai1_embed_entry
    WHERE collection_id = ${selected.id} AND table_name = ${table} AND row_id = ${id} AND part LIKE ${"text:%"}`;
  const pinned = { model: selected.model, dimensions: selected.dimensions };
  for (const part of old.map(String)) if (!parts.some((_, i) => part === `text:${i}`)) await remove(app, { table, id, part }, pinned);
  for (const [i, part] of parts.entries()) await indexText(app, { table, id, part: `text:${i}` }, part, pinned);
  if (imageError) throw imageError;
}

/** Reconcile generic text and file rows, including writes that bypassed table events. */
export async function sync(app: App, selection: Selection = {}): Promise<{ texts: number; files: number; errors: string[] }> {
  const db = app.db, live = new Set<string>(), errors: string[] = [];
  const selected = await group(app, selection);
  if (!selected) throw new Error("Create an embedding collection first");
  const pinned = { model: selected.model, dimensions: selected.dimensions };
  let texts = 0, files = 0;
  for (const table of TABLES) {
    const rows = table === "text_lang"
      ? await db.query`SELECT text_id, lang FROM text_lang`
      : await db.query`SELECT id FROM file`;
    for (const row of rows) {
      const id = db.table(table).entryId(row);
      if (!id) continue;
      live.add(`${table}\0${id}`);
      try { await indexRow(app, table, id, pinned); }
      catch (e) { errors.push(`${table}/${id}: ${e instanceof Error ? e.message : String(e)}`); }
      if (table === "text_lang") texts++;
      else files++;
    }
  }
  const old = await db.query`SELECT table_name, row_id, part FROM ai1_embed_entry
    WHERE collection_id = ${selected.id} AND (part LIKE ${"text:%"} OR part LIKE ${"image:%"})`;
  for (const row of old) {
    const table = String(row.table_name), id = String(row.row_id);
    if (TABLES.has(table) && !live.has(`${table}\0${id}`)) await remove(app, { table, id, part: String(row.part) }, pinned);
  }
  return { texts, files, errors };
}
