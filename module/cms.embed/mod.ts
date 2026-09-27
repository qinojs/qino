import { fs, sql, unhee } from "@qino/qino";
import { collection, index, remove, table } from "@qino/qino/ai1.embed";

import type { App } from "@qino/qino";
import type { Input, Ref } from "@qino/qino/ai1.embed";

type File = Awaited<ReturnType<App["dbFiles"]["file"]>>;

const plain = (html: unknown) => unhee(String(html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

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

/** Index the texts and titles of pages (source `text`, part = language) and page files (source
 *  `file`, part `text` or `image`) in the primary collection; drop the vectors pages no longer use. */
export async function sync(app: App): Promise<{ texts: number; files: number; errors: string[] }> {
  const c = await collection(app);
  if (!c) throw new Error("Create an embedding collection first");
  const db = app.db, t = sql.id(table(c)), errors: string[] = [];
  const fail = (ref: Ref, e: unknown) => errors.push(`${ref.source}/${ref.id}/${ref.part}: ${e instanceof Error ? e.message : String(e)}`);
  const put = (ref: Ref, input: Input) => index(app, ref, input).catch((e) => fail(ref, e));
  const used = sql`SELECT text_id FROM page_text UNION SELECT title_id FROM page`;

  const texts = await db.query`SELECT text_id, lang, text FROM text_lang WHERE text_id IN (${used})`;
  for (const row of texts) await put({ source: "text", id: Number(row.text_id), part: String(row.lang) }, plain(row.text));

  const vision = !!await db.one`SELECT 1 FROM ai1_model_capability c JOIN ai1_model m ON m.id = c.model_id
    WHERE m.name = ${c.model} AND c.capability = ${"vision"}`;
  const images = new Map((await db.query`SELECT source_id, hash FROM ${t} WHERE source = ${"file"} AND part = ${"image"}`)
    .map((row) => [Number(row.source_id), row.hash]));
  const files = await db.query`SELECT id, text, mime, md5 FROM file WHERE id IN (SELECT file_id FROM page_file)`;
  for (const row of files) {
    const id = Number(row.id), file = () => app.dbFiles.file(id);
    const text = row.text ?? await file().then((f) => f.extractText()).catch((e) => { fail({ source: "file", id, part: "text" }, e); return ""; });
    await put({ source: "file", id, part: "text" }, String(text));
    if (!vision || !row.md5 || !String(row.mime).startsWith("image/")) {
      if (images.has(id)) await remove(app, { source: "file", id, part: "image" });
      continue;
    }
    if (images.get(id) === row.md5) continue; // unchanged: the file need not be read
    const image = await file().then(dataUrl).catch((e) => void fail({ source: "file", id, part: "image" }, e));
    if (image) await put({ source: "file", id, part: "image" }, { image, hash: String(row.md5) });
  }

  await db.exec`DELETE FROM ${t} WHERE source = ${"text"} AND NOT EXISTS (SELECT 1 FROM text_lang x
    WHERE x.text_id = ${t}.source_id AND x.lang = ${t}.part AND x.text_id IN (${used}))`;
  await db.exec`DELETE FROM ${t} WHERE source = ${"file"} AND NOT EXISTS (SELECT 1 FROM page_file x WHERE x.file_id = ${t}.source_id)`;
  return { texts: texts.length, files: files.length, errors };
}
