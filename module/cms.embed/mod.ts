import { sql, unhee } from "@qino/qino";
import { collection, index, search } from "@qino/qino/ai.embed";
import { cms } from "@qino/qino/cms";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

/** Index each node's title and texts per language as one Markdown text (`embedding_node_text`) in the
 *  primary collection; drop what no node has any more. */
export async function sync(app: App): Promise<{ nodes: number; errors: string[] }> {
  const c = await collection(app);
  if (!c) throw new Error("No embedding collection");
  const db = app.db, errors: string[] = [];
  // the title first, then the texts by name
  const texts = sql`SELECT id AS node_id, title_id AS text_id, 0 AS n, '' AS name FROM page
    UNION ALL SELECT page_id, text_id, 1, name FROM page_text`;
  const nodes = new Map<string, { node_id: number; lang: string; parts: string[] }>();
  for (const row of await db.query`SELECT u.node_id, t.lang, u.n, t.text FROM (${texts}) u
      JOIN text_lang t ON t.text_id = u.text_id ORDER BY u.node_id, t.lang, u.n, u.name`) {
    const id = `${row.node_id} ${row.lang}`, text = markdown(row.text);
    const entry = nodes.getOrInsertComputed(id, () => ({ node_id: Number(row.node_id), lang: String(row.lang), parts: [] }));
    if (text) entry.parts.push(Number(row.n) ? text : `# ${text}`);
  }
  for (const { node_id, lang, parts } of nodes.values()) {
    await index(app, "node_text", { node_id, lang }, parts.join("\n\n")).catch((e) => errors.push(`node ${node_id} ${lang}: ${e instanceof Error ? e.message : e}`));
  }

  // what nodes no longer have; deleted nodes take their vectors along by themselves
  await db.exec`DELETE FROM embedding_node_text WHERE collection_id = ${c.id} AND NOT EXISTS (
    SELECT 1 FROM (${texts}) u JOIN text_lang t ON t.text_id = u.text_id
    WHERE u.node_id = embedding_node_text.node_id AND t.lang = embedding_node_text.lang)`;
  return { nodes: nodes.size, errors };
}

/** The pages nearest to `query` by meaning, in the request's language: by their texts and the files on
 *  them; only those `ctx` may read and that are searchable, below page `start` if given. Each page once,
 *  with its best hit, the best first. */
export async function find(ctx: Ctx, query: string, { start, limit = 20 }: { start?: number; limit?: number } = {}): Promise<{ page: Node; content: string; score: number }[]> {
  const { app } = ctx, tree = cms(app), root = start ? await tree.node(start) : undefined;
  const onPage = sql`e.file_id IN (SELECT file_id FROM page_file)`;
  const hits = await search(app, { node_text: sql`e.lang = ${ctx.lang}`, file_text: onPage, file_image: onPage }, query, { limit: 100 });
  const files = await app.db.query`SELECT file_id, page_id FROM page_file WHERE ${sql.in("file_id", hits.map((h) => h.key.file_id).filter(Boolean))}`;
  const found = new Map<number, { page: Node; content: string; score: number }>();
  for (const hit of hits) {
    const ids = hit.name === "node_text" ? [hit.key.node_id] : files.filter((f) => Number(f.file_id) === Number(hit.key.file_id)).map((f) => f.page_id);
    for (const id of ids) {
      const source = await tree.node(Number(id)), page = await source.page();
      if (found.has(page.id) || !page.vs.searchable || !await source.isReadable() || root && !await source.in(root)) continue;
      found.set(page.id, { page, content: hit.content, score: hit.score });
      if (found.size >= limit) return [...found.values()];
    }
  }
  return [...found.values()];
}
