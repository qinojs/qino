import { FileTransformer, sql, sqlSearch, unhee } from "@qino/qino";
import { ADMIN, cms, WRITE } from "@qino/qino/cms";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const LIMIT = 20;
const CANDIDATES = 500;
const idOf = (query: string) => /^\d+$/.test(query) && Number.isSafeInteger(Number(query)) ? Number(query) : 0;

/** The search is an editing tool; a login alone does not grant access. */
export async function allowed(ctx: Ctx, pid: number): Promise<boolean> {
  if (!ctx.user) return false;
  const cm = cms(ctx.app);
  if (await (await cm.node(pid)).access() < WRITE) return false;
  return (await cm.fire("module:access", { module: "cms.frontend.search", user: ctx.user, access: ADMIN })).access >= WRITE;
}

async function nodeUrl(node: Node, ctx: Ctx) {
  const page = await node.page();
  if (await node.access() < WRITE || await page.access() < WRITE) return node.url();
  const url = new URL(await node.url(), ctx.req.url.href);
  url.searchParams.set("cmspid", String(page.id));
  url.searchParams.set("cms_editmode", "1");
  return url.pathname + url.search + url.hash;
}

async function isReadable(node: Node) {
  return await node.isReadable() && await (await node.page()).isReadable();
}

async function breadcrumb(node: Node, ctx: Ctx) {
  const path = [];
  for (const parent of (await node.path()).values()) {
    if (parent.id === node.id || !await isReadable(parent)) continue;
    const title = (await parent.showTitle()).plain();
    if (!title && parent.vs.type === "c") continue;
    path.push({ id: parent.id, title: title || String(parent.vs.name || `#${parent.id}`), url: await nodeUrl(parent, ctx) });
  }
  return path;
}

/** A plain-text excerpt around a match; markup is added only by the client. */
async function snippet(node: Node, ctx: Ctx, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const rows = await ctx.app.db.query`SELECT t.text FROM page_text pt JOIN text_lang t ON t.text_id = pt.text_id
    WHERE pt.page_id = ${node.id} AND t.lang = ${ctx.lang} AND pt.name NOT LIKE ${"!_%"} ESCAPE '!' ORDER BY pt.name`;
  let text = "", score = -1;
  for (const row of rows) {
    const plain = unhee(String(row.text ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (!plain) continue;
    const matches = words.filter((word) => plain.toLowerCase().includes(word)).length;
    if (matches > score) { text = plain; score = matches; }
  }
  const match = text.search(new RegExp(words.map(RegExp.escape).join("|"), "i"));
  const start = Math.max(0, match - 60), end = start + 180;
  return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/** Node metadata and texts are searched together, so "cont.text lemon" also works. */
async function nodes(ctx: Ctx, query: string) {
  const cm = cms(ctx.app);
  const meta = sqlSearch(query, ["p.module", "p.name"]);
  const text = sqlSearch(query, ["p.module", "p.name", "t.text"]);
  const url = sqlSearch(query, ["p.module", "p.name", "u.url"]);
  const exactTitle = sql`EXISTS (SELECT 1 FROM text_lang t WHERE t.text_id = p.title_id AND t.lang = ${ctx.lang} AND LOWER(t.text) = ${query.toLowerCase()})`;
  const titleMatch = sql`EXISTS (SELECT 1 FROM text_lang t WHERE t.text_id = p.title_id AND t.lang = ${ctx.lang} AND ${text.where})`;
  const id = idOf(query);
  const rows = await ctx.app.db.query`
    SELECT p.id FROM page p WHERE p.id = ${id} OR ${meta.where}
      OR ${titleMatch}
      OR EXISTS (SELECT 1 FROM page_text pt JOIN text_lang t ON t.text_id = pt.text_id
        WHERE pt.page_id = p.id AND t.lang = ${ctx.lang} AND ${text.where})
      OR EXISTS (SELECT 1 FROM page_url u WHERE u.page_id = p.id AND u.lang = ${ctx.lang} AND ${url.where})
    ORDER BY p.id = ${id} DESC, ${exactTitle} DESC, LOWER(p.module) = ${query.toLowerCase()} DESC,
      ${titleMatch} DESC, COALESCE(${meta.where}, ${false}) DESC, p.id LIMIT ${CANDIDATES}`;
  const pages: { id: number; title: string; info: string; url: string; snippet: string; breadcrumb: Awaited<ReturnType<typeof breadcrumb>> }[] = [], contents: typeof pages = [];
  for (const row of rows) {
    const node = await cm.node(Number(row.id));
    const group = node.vs.type === "c" ? contents : pages;
    if (group.length >= LIMIT || !await isReadable(node)) continue;
    const page = await node.page();
    const pageTitle = (await page.showTitle()).plain();
    const module = String(node.vs.module ?? "");
    const title = (await node.showTitle()).plain() || pageTitle || module;
    group.push({
      id: node.id, title,
      info: `${module} · #${node.id}`,
      url: await nodeUrl(node, ctx),
      breadcrumb: await breadcrumb(node, ctx),
      snippet: await snippet(node, ctx, query),
    });
    if (pages.length >= LIMIT && contents.length >= LIMIT) break;
  }
  return { pages, contents };
}

async function files(ctx: Ctx, query: string) {
  const { db, dbFiles } = ctx.app;
  const cm = cms(ctx.app);
  const { where, order } = sqlSearch(query, ["name", "text", "mime"]);
  const id = idOf(query);
  const rows = await db.query`SELECT * FROM file WHERE id = ${id} OR ${where}
    ORDER BY id = ${id} DESC, ${order}, id DESC LIMIT ${CANDIDATES}`;
  const found = [];
  for (const row of rows) {
    const file = await dbFiles.file(Number(row.id), row);
    if (!await file.access() || !await file.exists()) continue;
    const pdf = file.mime === "application/pdf", video = file.mime.startsWith("video/");
    const preview = file.mime.startsWith("image/") || pdf && await FileTransformer.capabilities.magick || video && await FileTransformer.capabilities.ffmpeg;
    const thumb = preview ? await file.url({
      w: 96, h: 72, max: true, grant: "session",
      ...(pdf ? { fmt: "png", page: 1 } : video ? { fmt: "jpg", frame: 1 } : {}),
    }) : undefined;
    const pages = new Map<number, { id: number; title: string; url: string; breadcrumb: Awaited<ReturnType<typeof breadcrumb>> }>();
    for (const link of await db.query`SELECT page_id FROM page_file WHERE file_id = ${file.id} ORDER BY page_id`) {
      const node = await cm.node(Number(link.page_id));
      if (!await isReadable(node)) continue;
      const page = await node.page();
      if (pages.has(page.id)) continue;
      pages.set(page.id, { id: page.id, title: (await page.showTitle()).plain() || `#${page.id}`, url: await nodeUrl(page, ctx), breadcrumb: await breadcrumb(page, ctx) });
    }
    found.push({ id: file.id, title: file.name, info: `${row.mime ?? ""} · #${file.id}`, url: await file.url({ grant: "session" }), thumb, pages: [...pages.values()] });
    if (found.length >= LIMIT) break;
  }
  return found;
}

async function users(ctx: Ctx, query: string) {
  const node = await cms(ctx.app).nodeByModule("cms.backend.users");
  if (!node || !await isReadable(node)) return [];
  const { where, order } = sqlSearch(query, ["u.given_name", "u.family_name", "u.username", "u.organization"]);
  const contact = sqlSearch(query, ["c.address"]);
  const id = idOf(query);
  const superuser = ctx.user?.superuser ? sql`` : sql`AND u.superuser = ${false}`;
  const rows = await ctx.app.db.query`
    SELECT u.id, u.given_name, u.family_name, u.username, u.organization FROM usr u
    WHERE (u.id = ${id} OR ${where} OR EXISTS (SELECT 1 FROM usr_contact c WHERE c.usr_id = u.id AND ${contact.where})) ${superuser}
    ORDER BY u.id = ${id} DESC, ${order}, u.id LIMIT ${LIMIT}`;
  const base = await nodeUrl(node, ctx);
  return rows.map((row) => {
    const url = new URL(base, ctx.req.url.href);
    url.searchParams.set("id", String(row.id));
    return {
      id: Number(row.id), title: [row.given_name, row.family_name].filter(Boolean).join(" ") || row.username || `#${row.id}`,
      info: [row.username, row.organization, `#${row.id}`].filter(Boolean).join(" · "), url: url.pathname + url.search + url.hash,
    };
  });
}

export async function search(ctx: Ctx, query: string) {
  query = query.trim();
  if (!query) return { pages: [], contents: [], files: [], users: [], limit: LIMIT };
  const [found, fileHits, userHits] = await Promise.all([nodes(ctx, query), files(ctx, query), users(ctx, query)]);
  return { ...found, files: fileHits, users: userHits, limit: LIMIT };
}
