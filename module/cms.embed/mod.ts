import { fs, sql, unhee } from "@qino/qino";
import { collection, index, remove } from "@qino/qino/ai1.embed";

import type { App } from "@qino/qino";
import type { Input, Key } from "@qino/qino/ai1.embed";

type File = Awaited<ReturnType<App["dbFiles"]["file"]>>;

/** Rich text as Markdown: headings, lists, paragraphs and bold survive, the rest becomes text. The
 *  structure gives the model context and lets long texts be cut between paragraphs. */
const markdown = (html: unknown) => unhee(String(html ?? "")
  .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
  .replace(/<li\b[^>]*>/gi, "\n- ")
  .replace(/<br\b[^>]*>/gi, "\n")
  .replace(/<\/?(?:p|div|ul|ol|table|tr|blockquote|h[1-6])\b[^>]*>/gi, "\n\n")
  .replace(/<\/?(?:strong|b)>/gi, "**")
  .replace(/<[^>]*>/g, ""))
  .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

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

/** Index each node's title and texts per language as one Markdown text (`embedding_node_text`) and
 *  the files attached to nodes (`embedding_file_text`, `embedding_file_image`) in the primary
 *  collection; drop what no node uses any more. */
export async function sync(app: App): Promise<{ nodes: number; files: number; errors: string[] }> {
  const c = await collection(app);
  if (!c) throw new Error("Create an embedding collection first");
  const db = app.db, errors: string[] = [];
  const fail = (name: string, key: Key, e: unknown) => errors.push(`${name} ${JSON.stringify(key)}: ${e instanceof Error ? e.message : String(e)}`);
  const put = (name: string, key: Key, input: Input) => index(app, name, key, input).catch((e) => fail(name, key, e));
  // the title first, then the texts by name
  const texts = sql`SELECT id AS node_id, title_id AS text_id, 0 AS n, '' AS name FROM page
    UNION ALL SELECT page_id, text_id, 1, name FROM page_text`;
  const nodes = new Map<string, { node_id: number; lang: string; parts: string[] }>();
  for (const row of await db.query`SELECT u.node_id, t.lang, u.n, t.text FROM (${texts}) u
      JOIN text_lang t ON t.text_id = u.text_id ORDER BY u.node_id, t.lang, u.n, u.name`) {
    const id = `${row.node_id} ${row.lang}`, text = markdown(row.text);
    if (!nodes.has(id)) nodes.set(id, { node_id: Number(row.node_id), lang: String(row.lang), parts: [] });
    if (text) nodes.get(id)!.parts.push(Number(row.n) ? text : `# ${text}`);
  }
  for (const { node_id, lang, parts } of nodes.values()) await put("node_text", { node_id, lang }, parts.join("\n\n"));

  const images = new Map((await db.query`SELECT file_id, hash FROM embedding_file_image WHERE collection_id = ${c.id}`)
    .map((row) => [Number(row.file_id), row.hash]));
  const files = await db.query`SELECT id, text, mime, md5 FROM file WHERE id IN (SELECT file_id FROM page_file)`;
  for (const row of files) {
    const key = { file_id: Number(row.id) }, file = () => app.dbFiles.file(key.file_id);
    const text = row.text ?? await file().then((f) => f.extractText()).catch((e) => { fail("file_text", key, e); return ""; });
    await put("file_text", key, String(text));
    if (!c.vision || !row.md5 || !String(row.mime).startsWith("image/")) {
      if (images.has(key.file_id)) await remove(app, "file_image", key);
      continue;
    }
    if (images.get(key.file_id) === row.md5) continue; // unchanged: the file need not be read
    const image = await file().then(dataUrl).catch((e) => void fail("file_image", key, e));
    if (image) await put("file_image", key, { image, hash: String(row.md5) });
  }

  // what nodes no longer use; deleted nodes and files take their vectors along by themselves
  await db.exec`DELETE FROM embedding_node_text WHERE collection_id = ${c.id} AND NOT EXISTS (
    SELECT 1 FROM (${texts}) u JOIN text_lang t ON t.text_id = u.text_id
    WHERE u.node_id = embedding_node_text.node_id AND t.lang = embedding_node_text.lang)`;
  for (const name of ["embedding_file_text", "embedding_file_image"]) {
    await db.exec`DELETE FROM ${sql.id(name)} WHERE collection_id = ${c.id}
      AND NOT EXISTS (SELECT 1 FROM page_file x WHERE x.file_id = ${sql.id(name)}.file_id)`;
  }
  return { nodes: nodes.size, files: files.length, errors };
}
