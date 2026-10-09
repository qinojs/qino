import { sql, unhee } from "@qino/qino";
import { collection, index } from "@qino/qino/ai1.embed";

import type { App } from "@qino/qino";

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
