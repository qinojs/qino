// deno-lint-ignore-file no-explicit-any
import { typeByExtension, sql } from "../deps.ts";
import { grant } from "./crypto.ts";
import { File } from "./File.ts";
import { fs } from "./fs.ts";
import { getCtx } from "./ctx/Ctx.ts";
import { tableRef, scopeCache } from "./db/dbScope.ts";
import { fetchRemoteFile, mimeType, readDataUrl, readUploadFile } from "./fileStream.ts";
import { header, unixTime } from "./util.ts";

import type { App } from "./App.ts";
import type { Db } from "./db/Db.ts";
import type { UploadedFile } from "./fileStream.ts";
import type { TransformOptions } from "./transform/mod.ts";

/** Remove file rows no child table links to, older than a week. */
export async function deleteUnlinkedDbFiles(app: App): Promise<{ deleted: number }> {
  const { db, dbFiles: fm } = app;
  const ago = unixTime() - 60 * 60 * 24 * 7;
  const notLinked = db.table("file").children.map((dbFile) =>
    sql`NOT EXISTS (SELECT 1 FROM ${sql.id(dbFile.table.name)} c WHERE c.${sql.id(dbFile.name)}=file.id)`);
  const rows = await db.query`SELECT file.id FROM file
    LEFT JOIN log log_i ON file.log_id=log_i.id LEFT JOIN log log_e ON file.log_id_ch=log_e.id
    WHERE (log_i.id IS NULL OR log_i.time<${ago}) AND (log_e.id IS NULL OR log_e.time<${ago})${notLinked.length ? sql` AND ${sql.join(notLinked, " AND ")}` : sql``}`;
  let deleted = 0;
  for (const row of rows) {
    const f = await fm.file(row.id);
    if (!await f.used() && !await f.access()) { await f.remove(); deleted++; }
  }
  return { deleted };
}

export class DbFileManager {
  #cache = new Map<string, DbFile>();
  #app: App;
  #directory: string;

  constructor(app: App, directory: string) {
    this.#app = app;
    this.#directory = directory.endsWith("/") ? directory : directory + "/";
    fs.mkdir(this.#directory).catch(() => {});
  }

  get app(): App { return this.#app; }
  get db(): Db { return this.#app.db; }
  get directory(): string { return this.#directory; }

  #files(): Map<string, DbFile> {
    return scopeCache<Map<string, DbFile>>(this.#cache, "dbFiles", () => new Map());
  }

  /** The cached object for this file; `vs` preloads a new one (ignored on a cache hit). */
  async file(id: number | string, vs?: any): Promise<DbFile> {
    const file = this.#files().getOrInsertComputed(String(id), () => new DbFile(this, id, vs));
    if (!file.vs) await file.ensureVs();
    return file;
  }

  clearCache(id?: number | string) {
    const cache = this.#files();
    if (id !== undefined) cache.delete(String(id));
    else cache.clear();
  }

  async add(source?: string | globalThis.File): Promise<DbFile> {
    const id = Number(await this.db.table("file").insert({}) ?? "0");
    const f = await this.file(id);
    if (typeof source === "string") await f.replaceBy(source);
    else if (source) await f.replaceFromUpload(await readUploadFile(source));
    return f;
  }

  async output(request: string, req: Request): Promise<Response> {
    const parts = request.split("/");
    const id = Number(parts.shift() ?? "0");
    const name = parts.pop() ?? "";

    const params: Record<string, string | true> = {};
    for (const part of parts) {
      const pair = part.split("-");
      params[pair[0]] = pair[1] ?? true;
    }

    const f = await this.file(id);
    if (!await f.exists()) return new Response(null, { status: 404 });
    if (f.vs?.access != "1") {
      const ctx = getCtx();
      const query = ctx.req.query;
      const resource = grantResource(id, parts);
      const granted = query.exp
        ? grant.verify(ctx.sess, resource, query) === "ok"
        : await grant.verify(ctx.app, permanentResource(resource, f.vs?.md5), query) === "ok";
      if (!granted && !await f.access()) return new Response(null, { status: 403 });
    }

    const headers = new Headers();

    const mtime = await f.mtime();
    if (mtime !== undefined) headers.set("Last-Modified", new Date(mtime * 1000).toUTCString());
    headers.set("Cache-Control", `max-age=${60 * 60 * 24 * 180}, private, immutable`);

    // The format may depend on the Accept header, so caches must key on it.
    headers.append("Vary", "Accept");
    const { path: outputPath, mime: outputMime, key, transformed, error } = await f.transform(params, req.headers.get("accept") ?? undefined);
    if (error && isTransformRequest(params)) return new Response(error.message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    let mime = mimeType(outputMime || typeByExtension(f.extension) || "application/octet-stream");

    if (!transformed && (/\.pdf$/.test(name) || mime === "application/pdf")) {
      mime = "application/pdf";
      headers.set(...header.contentDisposition("inline", f.name));
      headers.set("Cache-Control", "no-cache");
    }

    if ("dl" in params) {
      headers.set("Cache-Control", "private, no-cache");
      headers.set(...header.contentDisposition("attachment", f.name));
    }

    if (params.as === "text") mime = "text/plain";

    // A file is never a page of this site: documents run sandboxed (no script, no forms, opaque
    // origin). Except PDF — Chrome won't show it sandboxed, and its viewer isolates itself. Markup is
    // sent as source, since a sandbox still follows <meta> refresh. SVG stays an image.
    if (MARKUP.test(mime) && mime !== "image/svg+xml") mime = "text/plain";
    if (mime !== "application/pdf") headers.set("Content-Security-Policy", "sandbox");
    headers.set("X-Content-Type-Options", "nosniff");

    if (mime === "image/svg+xml" || mime === "text/markdown") mime += "; charset=utf-8";
    headers.set("Content-Type", mime);

    // Cache key as ETag; the cache file's mtime is touched for LRU, so unusable
    const etag = `"qg${key ?? await fs.mtime(outputPath) ?? 0}"`;
    headers.set("ETag", etag);
    const inm = req.headers.get("if-none-match");
    if (inm ? etagMatch(inm, etag) : Date.parse(req.headers.get("if-modified-since") ?? "") >= mtime! * 1000) {
      return new Response(null, { status: 304, headers });
    }

    headers.set("Accept-Ranges", "bytes");
    const rangeHeader = req.headers.get("range");
    const ifRange = req.headers.get("if-range"); // stale validator: send the whole file
    if (rangeHeader && (!ifRange || ifRange === etag || Date.parse(ifRange) === mtime! * 1000)) {
      const range = await openRange(outputPath, rangeHeader);
      if (typeof range === "number") {
        headers.set("Content-Range", `bytes */${range}`);
        return new Response(null, { status: 416, headers });
      }
      if (range) {
        headers.set("Content-Range", range.contentRange);
        headers.set("Content-Length", String(range.length));
        return new Response(range.stream, { status: 206, headers });
      }
    }

    const stream = await fs.stream(outputPath);
    headers.set("Content-Length", String(await fs.size(outputPath)));
    return new Response(stream, { status: 200, headers });
  }

}

export class DbFile extends File {
  #manager: DbFileManager;
  id: number;
  vs?: Record<string, any>;

  /** With `vs` this is a detached view of that row (e.g. a historical one) — only outside the manager cache. */
  constructor(manager: DbFileManager, id: number | string, vs?: Record<string, any>) {
    super("");
    this.#manager = manager;
    this.id = Number(id);
    if (vs) this.setLocalVs(vs);
  }

  override get extension(): string { return String(this.vs?.name ?? "").replace(/.*\./, "").toLowerCase(); }

  /** Normalized on read too, for old rows. */
  override get mime(): string { return mimeType(this.vs?.mime ?? ""); }

  get name(): string { return this.vs?.name ?? ""; }

  set name(value: string) {
    if (this.vs) this.vs.name = value;
    this.setVs({ name: value }).catch(console.error);
  }

  setLocalVs(vs: Record<string, any>) {
    this.vs = vs;
    this.path = vs.md5 ? this.#manager.directory + vs.md5 : "";
  }

  async ensureVs(): Promise<Record<string, any>> {
    if (this.id && !this.vs) {
      this.vs = await this.#manager.db.row`SELECT * FROM ${sql.id(tableRef("file"))} WHERE id = ${this.id}` ?? {};
      this.path = this.vs.md5 ? this.#manager.directory + this.vs.md5 : "";
    }
    return this.vs!;
  }

  /** Re-read the row after a write that bypassed the manager; keeps the same object. */
  async reload(): Promise<this> { this.vs = undefined; await this.ensureVs(); return this; }

  async get(field: string): Promise<any> { return (await this.ensureVs())[field]; }

  override async exists(): Promise<this | undefined> { await this.ensureVs(); return super.exists(); }

  async setVs(vs: Record<string, any>) {
    await this.#manager.db.table("file").update(this.id, vs);
    if (this.vs) {
      Object.assign(this.vs, vs);
      if (this.vs.md5) this.path = this.#manager.directory + this.vs.md5;
    }
  }

  async url(params: TransformOptions & { grant?: "session" | "permanent" } = {}): Promise<string> {
    const vs = await this.ensureVs();
    const { grant: mode, ...options } = params;
    const u = `u-${String(vs.md5 ?? "").slice(0, 5)}`;
    const parts = [u, ...Object.entries(options).map(([k, v]) => v === true || k === "max" ? k : `${k}-${v}`)];
    const ctx = getCtx();
    const url = ctx.req.appUrl + "dbFile/" + this.id + "/" + parts.join("/") + "/" + encodeURIComponent(this.name);
    if (!mode) return url;
    if (mode !== "session" && mode !== "permanent") throw new Error(`Unsupported DbFile grant: ${mode}`);
    const resource = grantResource(this.id, parts);
    const query = new URLSearchParams(mode === "session"
      ? grant.sign(ctx.sess, resource)
      : await grant.sign(ctx.app, permanentResource(resource, vs.md5)));
    return url + "?" + query;
  }

  async access(set?: any): Promise<boolean> {
    if (set !== undefined) { await this.setVs({ access: set ? 1 : 0 }); return !!set; }
    const vs = await this.ensureVs();
    const e = await this.#manager.app.fire("dbFile:access", { file: this, access: vs.access == "1" }); // fast path
    if (!e.access) await this.#manager.app.fire("dbFile:access-fallback", e);  // slow path, only if unresolved
    return e.access;
  }

  // async updateDb() { // not ussed?
  //   const { md5 } = await this.ensureVs();
  //   this.path = this.#manager.directory + md5;
  //   await this.setVs({ text: await this.getText(), size: await this.size() });
  // }

  async used(): Promise<boolean> {
    for (const field of this.#manager.db.table("file").children) {
      if (await this.#manager.db.one`SELECT 1 FROM ${sql.id(field.table.name)} WHERE ${sql.id(field.name)} = ${this.id} LIMIT 1`) return true;
    }
    return false;
  }

  async remove() {
    const db = this.#manager.db;
    const { md5 } = await this.ensureVs();
    await db.table("file").delete(this.id);
    const e = await this.#manager.app.fire("dbFile:unlink-before", { file: this, prevent: false });
    this.path = "";
    if (e.prevent || !md5) return;
    // Deferred: a blob can't be restored, so unlink only after commit.
    await db.afterCommit(async () => {
      const still = await db.one`SELECT id FROM ${sql.id(tableRef("file"))} WHERE md5 = ${md5}`;
      if (!still) await fs.remove(this.#manager.directory + md5);
    });
  }

  async replaceBy(path: string) {
    if (/^(https?|data):/.test(path)) {
      const maxSize = await this.#manager.app.settings.core.uploadMaxFileSize as number;
      return this.replaceFromUpload(path.startsWith("data:") ? await readDataUrl(path, { maxSize }) : await fetchRemoteFile({ url: path, maxSize }));
    }
    const src = new File(path);

    const md5 = await src.md5();
    this.path = this.#manager.directory + md5;
    await fs.mkdir(this.#manager.directory);
    if (!await src.copyTo(this.path)) throw new Error(`Copy failed: ${path} → ${this.path}`);

    await this.setVs({ name: src.basename(), mime: mimeType(src.mime), md5, size: await this.size(), text: null });
  }

  async replaceFromUpload(f: UploadedFile) {
    this.path = this.#manager.directory + f.md5;
    await fs.mkdir(this.#manager.directory);
    await fs.rename(f.tmpPath, this.path);

    const ext = f.name.replace(/.*\./, "").toLowerCase();
    const type = f.type === "application/octet-stream" ? mimeType(typeByExtension(ext) ?? f.type) : f.type;

    await this.setVs({ name: f.name, mime: type, md5: f.md5, size: await this.size(), text: null });
  }

  async clone(to?: number | null): Promise<DbFile> {
    const data = { ...await this.ensureVs() };
    if (to == null) {
      delete data.id;
      const id = Number(await this.#manager.db.table("file").insert(data) ?? "0");
      return this.#manager.file(id);
    }
    data.id = String(to);
    await this.#manager.db.table("file").update(to, data);
    return (await this.#manager.file(to)).reload(); // the update bypassed the manager
  }

  async transform(param: Record<string, unknown>, accept?: string): Promise<{ path: string; mime: string; key?: string; transformed?: boolean; error?: Error }> {
    await this.ensureVs();
    if (!this.path) return { path: this.path, mime: this.mime };
    const dbMime = this.mime;
    const result = await this.#manager.app.fileTransformer.transform(this.path, parseTransformOptions(param), dbMime, accept);
    return { path: result.path, mime: result.mime || dbMime, key: result.key, transformed: result.transformed, error: result.error };
  }

  /** Fill the searchable `text` column: text files as is, others via the `fmt=md` pipeline
   *  (pandoc, pdftotext, OCR, transcript), capped in length. `""` = no text, `null` = not extracted
   *  yet. Throws if a tool fails or times out. */
  async extractText(): Promise<string> {
    if (!await this.exists()) return "";
    let path = this.path;
    let text = "";
    if (this.mime.startsWith("text/")) text = await fs.text(path).catch(() => "");
    else {
      const r = await this.transform({ fmt: "md" });
      if (r.error) throw r.error;
      if (r.transformed) text = await fs.text((path = r.path)).catch(() => "");
    }
    text = text.slice(0, MAX_TEXT);
    await this.setVs({ text });
    const { md5 } = this.vs!; // same blob, same text — reuse it
    if (md5) await this.#manager.db.query`UPDATE ${sql.id(tableRef("file"))} SET text=${text} WHERE md5=${md5} AND id!=${this.id}`;
    return text;
  }

  override toString(): string { return String(this.id); }

}

function grantResource(id: number, parts: string[]): string {
  return `dbFile\0${id}/${parts.join("/")}`;
}

function permanentResource(resource: string, md5: unknown): string {
  return `${resource}\0${String(md5 ?? "")}`;
}

/** Max length of a file's extracted `text`. Small, because every `SELECT f.*` loads it, and search
 *  results only need the beginning. */
const MAX_TEXT = 8_000;

/** What a browser renders as a document: html and any xml (xhtml, rss, xslt, svg). */
const MARKUP = /^text\/html$|xml$|xsl$/;

const numOptions = ['w', 'h', 'q', 'vpos', 'hpos', 'zoom', 'dpr', 'page', 'frame'] as const;
const transformOptions = ['fmt', 'max', ...numOptions];

function parseTransformOptions(param: Record<string, unknown>): TransformOptions {
  const opt: TransformOptions = { fmt: param.fmt as TransformOptions['fmt'] };
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  for (const k of numOptions) opt[k] = num(param[k]); // absent → NaN → undefined
  opt.max = 'max' in param ? param.max !== 'false' && param.max !== '0' : undefined;
  return opt;
}

/** `If-None-Match` per RFC 9110: a list, `*`, and weak tags all match. */
function etagMatch(header: string, etag: string) {
  return header === "*" || header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

function isTransformRequest(param: Record<string, unknown>): boolean {
  return transformOptions.some((k) => k in param);
}

/** Stream a single `bytes=` range; a number = unsatisfiable (416, that size), null = serve the full file. */
async function openRange(filePath: string, rangeHeader: string) {
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/); // multi-range unsupported
  if (!m || (!m[1] && !m[2])) return null;
  const size = await fs.size(filePath);
  if (size === undefined) return null;
  const start = m[1] === "" ? Math.max(size - Number(m[2]), 0) : Number(m[1]); // `-n` = last n bytes
  const end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) return size;
  const stream = await fs.stream(filePath, { start, end }).catch(() => null);
  return stream && { stream, length: end - start + 1, contentRange: `bytes ${start}-${end}/${size}` };
}
