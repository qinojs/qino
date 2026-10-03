import { ApiError, errMsg, sha256hex, sql, sqlSearch, unixTime } from "@qino/qino";
import { collection, index, search as nearest } from "@qino/qino/ai1.embed";

import { brave } from "./engines/brave.ts";
import { serper } from "./engines/serper.ts";
import { own } from "./readers/fetch.ts";
import { firecrawl } from "./readers/firecrawl.ts";
import { jina } from "./readers/jina.ts";

import type { App } from "@qino/qino";

/** A page found: its title, address, and a snippet of it. */
type Result = { title: string; url: string; snippet: string };
/** A search engine: with its key, the pages for `query`, at most `count`. */
export type Engine = (key: string, query: string, count: number) => Promise<Result[]>;
/** A page read: its title and its content as Markdown. */
type Page = { title: string; content: string };
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
  const db = app.db, hash = await sha256hex(url);
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

/** Links of a page in Markdown (`[text](url)`, `<url>`), absolute and without their #fragment. */
function links(markdown: string, base: string): string[] {
  return [...markdown.matchAll(/\]\(<?([^)\s>]+)|<(https?:\/\/[^>\s]+)>/g)].flatMap(([, href, bare]) => {
    const url = URL.parse(href ?? bare, base);
    return url && /^https?:$/.test(url.protocol) ? [(url.hash = "", url.href)] : [];
  });
}

/** Files that are no pages to read: images, media, archives, code. */
const NO_PAGE = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|mp[34]|webm|ogg|wav|zip|gz|css|js)$/i;

/** Read the pages below `url`, following their links that start with it, at most `max`; the pages
 *  younger than `maxAge` are taken from the cache. What was read can be searched with `pages`. */
export async function crawl(app: App, url: string, { max = 100, maxAge }: { max?: number; maxAge?: number } = {}) {
  const todo = [url], seen = new Set(todo), failed: string[] = [];
  let done = 0;
  while (todo.length && done < max) {
    const at = todo.shift()!;
    const page = await read(app, at, { maxAge }).catch((e) => void failed.push(`${at}: ${errMsg(e)}`));
    if (!page) continue;
    done++;
    for (const link of links(String(page.content ?? ""), at)) {
      if (!link.startsWith(url) || seen.has(link) || NO_PAGE.test(new URL(link).pathname)) continue;
      seen.add(link);
      todo.push(link);
    }
  }
  return { read: done, failed, left: todo.length };
}

/** The pages read, the latest first; with `query` those nearest to it by meaning, with the closest part
 *  (without an embedding collection: those with most of its words); with `root` only those whose url
 *  starts with it, e.g. what a crawl from there read. */
export async function pages(app: App, query?: string, { root, limit = 20 }: { root?: string; limit?: number } = {}) {
  const db = app.db;
  // '!' escapes LIKE's wildcards in every dialect (as sqlSearch)
  const within = root ? sql`url LIKE ${root.replace(/[!%_]/g, "!$&") + "%"} ESCAPE '!'` : sql`${true}`;
  if (!query) return db.query`SELECT id, url, title, reader, time FROM ai1_web_page WHERE ${within} ORDER BY time DESC LIMIT ${limit}`;
  if (!await collection(app)) {
    const { where, order } = sqlSearch(query, ["title", "content"]);
    return db.query`SELECT id, url, title, reader, time FROM ai1_web_page WHERE ${where} AND ${within} ORDER BY ${order} LIMIT ${limit}`;
  }
  const hits = await nearest(app, { ai1_web_page: root ? sql`e.page_id IN (SELECT id FROM ai1_web_page WHERE ${within})` : true }, query, { limit });
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
