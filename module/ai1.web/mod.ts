import { ApiError, errMsg, sql, sqlSearch, unixTime } from "@qino/qino";
import { collection, index, search as nearest } from "@qino/qino/ai1.embed";

import { brave } from "./lib/brave.ts";
import { firecrawl, jina, own } from "./lib/readers.ts";
import { serper } from "./lib/serper.ts";

import type { App } from "@qino/qino";

/** A page found: its title, address, and a snippet of it. */
export type Result = { title: string; url: string; snippet: string };
/** A search engine: with its key, the pages for `query`, at most `count`. */
export type Engine = (key: string, query: string, count: number) => Promise<Result[]>;
/** A page read: its title and its content as Markdown. */
export type Page = { title: string; content: string };
/** Who reads a page; `key` is empty for our own fetch. */
export type Reader = (app: App, url: string, key: string) => Promise<Page>;

/** The engines by the name of their key in core.keys, tried in this order. */
export const ENGINES: Record<string, Engine> = { "api.search.brave.com": brave, "google.serper.dev": serper };
/** The readers by name, one chosen in the settings; a service with the name of its key in core.keys. */
export const READERS: Record<string, { key?: string; read: Reader }> = {
  fetch: { read: own },
  jina: { key: "api.jina.ai", read: jina },
  firecrawl: { key: "api.firecrawl.dev", read: firecrawl },
};
/** A page read is read again after this many seconds. */
const MAX_AGE = 86400;

const keyOf = async (app: App, name: string) => String(await app.settings.core.keys[name] ?? "");
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toHex();

/** Search the web with the first engine that has a key; if it fails, with the next. */
export async function search(app: App, query: string, { count = 10 }: { count?: number } = {}): Promise<Result[]> {
  const failed: string[] = [];
  for (const [name, engine] of Object.entries(ENGINES)) {
    const key = await keyOf(app, name);
    if (!key) continue;
    try { return await engine(key, query, count); } catch (e) { failed.push(errMsg(e)); }
  }
  throw failed.length
    ? new ApiError(502, failed.join("; "))
    : new ApiError(503, `No search engine: set a key in core.keys for ${Object.keys(ENGINES).join(" or ")}`);
}

/** A page as Markdown, from the cache while younger than `maxAge` seconds; else read by the reader of
 *  the settings, kept, and made findable by meaning in the background (ai1.embed). */
export async function read(app: App, url: string, { maxAge = MAX_AGE }: { maxAge?: number } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "url: http or https");
  const db = app.db, hash = await sha256(url);
  const kept = await db.row`SELECT id, url, title, content, reader, time FROM ai1_web_page WHERE url_hash = ${hash}`;
  if (kept && Number(kept.time) > unixTime() - maxAge) return kept;
  const name = String(await app.settings["ai1.web"].reader), reader = READERS[name];
  if (!reader) throw new ApiError(503, `No reader "${name}"`);
  const key = reader.key ? await keyOf(app, reader.key) : "";
  if (reader.key && !key) throw new ApiError(503, `Reader ${name}: set a key in core.keys for ${reader.key}`);
  const page = await reader.read(app, url, key).catch((e) => { throw new ApiError(502, errMsg(e)); });
  const values = { url, url_hash: hash, title: page.title, content: page.content, reader: name, time: unixTime() };
  const id = kept ? (await db.table("ai1_web_page").update(Number(kept.id), values), Number(kept.id)) : Number(await db.table("ai1_web_page").insert(values));
  if (await collection(app)) index(app, "ai1_web_page", { page_id: id }, page.content).catch((e) => console.error("[ai1.web] embedding:", errMsg(e)));
  return { id, ...values };
}

/** The pages read, the latest first; with `query` those nearest to it by meaning, with the closest part
 *  (without an embedding collection: those with most of its words). */
export async function pages(app: App, query?: string, { limit = 20 }: { limit?: number } = {}) {
  const db = app.db;
  if (!query) return db.query`SELECT id, url, title, reader, time FROM ai1_web_page ORDER BY time DESC LIMIT ${limit}`;
  if (!await collection(app)) {
    const { where, order } = sqlSearch(query, ["title", "content"]);
    return db.query`SELECT id, url, title, reader, time FROM ai1_web_page WHERE ${where} ORDER BY ${order} LIMIT ${limit}`;
  }
  const hits = await nearest(app, "ai1_web_page", query, { limit });
  const rows = new Map((await db.query`SELECT id, url, title, reader, time FROM ai1_web_page
    WHERE ${sql.in("id", hits.map((h) => h.key.page_id))}`).map((r) => [Number(r.id), r]));
  // a page once, at its closest part
  const seen = new Set<number>();
  return hits.flatMap(({ key, content, score }) => {
    const row = rows.get(Number(key.page_id));
    if (!row || seen.has(Number(row.id))) return [];
    seen.add(Number(row.id));
    return [{ ...row, part: content, score }];
  });
}
