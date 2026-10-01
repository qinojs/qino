import { errMsg, fs, sql } from "@qino/qino";

import { collection, index, remove } from "../mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

// Every file of the core table `file`: its text in `embedding_file_text`, an image in `embedding_file_image`.

type File = Awaited<ReturnType<App["dbFiles"]["file"]>>;

/** PNG and JPEG as they are, other images through the transform pipeline; undefined if none fits. */
async function dataUrl(file: File): Promise<string | undefined> {
  if (!await file.exists()) return;
  let { path, mime } = file;
  if (!["image/png", "image/jpeg"].includes(mime)) {
    const png = await file.transform({ fmt: "png" });
    if (png.error || png.mime !== "image/png") return;
    ({ path, mime } = png);
  }
  return `data:${mime};base64,${(await fs.bytes(path)).toBase64()}`;
}

/** Embed file `id` in the primary collection: its text, and the image when the model has vision. */
export async function indexFile(app: App, id: number): Promise<void> {
  const c = await collection(app), row = await app.db.row`SELECT text, mime, md5 FROM file WHERE id = ${id}`;
  if (!c || !row?.md5) return;
  const key = { file_id: id }, file = await app.dbFiles.file(id);
  await index(app, "file_text", key, String(row.text ?? await file.extractText()));
  const image = c.vision && String(row.mime).startsWith("image/") ? await dataUrl(file) : undefined;
  image ? await index(app, "file_image", key, { image, hash: String(row.md5) }) : await remove(app, "file_image", key);
}

/** Embed the files the primary collection has nothing of yet. */
export async function indexFiles(app: App): Promise<{ files: number; errors: string[] }> {
  const c = await collection(app);
  if (!c) throw new Error("No embedding collection");
  const missing = (table: string) => sql`NOT EXISTS (SELECT 1 FROM ${sql.id(table)} e WHERE e.file_id = f.id AND e.collection_id = ${c.id})`;
  const ids = await app.db.col`SELECT id FROM file f WHERE md5 IS NOT NULL AND ((text IS NULL OR text <> '') AND ${missing("embedding_file_text")}
    OR ${c.vision} AND mime LIKE 'image/%' AND ${missing("embedding_file_image")})`;
  const errors: string[] = [];
  for (const id of ids) await indexFile(app, Number(id)).catch((e) => errors.push(`file ${id}: ${errMsg(e)}`));
  return { files: ids.length, errors };
}

/** New and replaced files carry an md5: drop the old vectors and embed anew in the background; what
 *  fails is missing then, and the cron catches up on it. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  for (const event of ["table:insert-after", "table:update-after"] as const) {
    app.db.on(event, async ({ table, id, data }) => {
      if (table.name !== "file" || !data.md5 || !await app.settings["ai1.embed"].files) return;
      const key = { file_id: Number(id) };
      Promise.all([remove(app, "file_text", key), remove(app, "file_image", key)]).then(() => indexFile(app, key.file_id)).catch(console.error);
    }, { signal });
  }
}

export const cron = {
  files: {
    every: "hour",
    run: async (app: App) => {
      if (await app.settings["ai1.embed"].files) await indexFiles(app); }
    },
} satisfies Jobs;
