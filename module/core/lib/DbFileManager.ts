// deno-lint-ignore-file no-explicit-any
import { typeByExtension, sql } from "../deps.ts";
import * as grant from "./crypto/grant.ts";
import { File } from "./File.ts";
import { getCtx } from "./ctx/Ctx.ts";
import { tableRef, scopeCache } from "./db/dbScope.ts";
import { fetchRemoteFile, readDataUrl, readUploadFile } from "./fileStream.ts";
import { header } from "./util.ts";

import type { App } from "./App.ts";
import type { Db } from "./db/Db.ts";
import type { UploadedFile } from "./fileStream.ts";
import type { TransformOptions } from "./transform/mod.ts";

/** Move a file, falling back to copy+remove when rename fails (e.g. across filesystems). */
async function moveFile(from: string, to: string) {
  try { await Deno.rename(from, to); }
  catch { await Deno.copyFile(from, to); await Deno.remove(from).catch(() => {}); }
}

export class DbFileManager {
  #cache = new Map<string, DbFile>();
  #app: App;
  #directory: string;

  constructor(app: App, directory: string) {
    this.#app = app;
    this.#directory = directory.endsWith("/") ? directory : directory + "/";
    Deno.mkdir(this.#directory, { recursive: true }).catch(() => {});
  }

  get app(): App { return this.#app; }
  get db(): Db { return this.#app.db; }
  get directory(): string { return this.#directory; }

  #files(): Map<string, DbFile> {
    return scopeCache<Map<string, DbFile>>(this.#cache, "dbFiles", () => new Map());
  }

  async file(id: number | string, vs?: any): Promise<DbFile> {
    const file = this.#files().getOrInsertComputed(String(id), () => new DbFile(this, id));
    if (vs) file.setLocalVs(vs);
    else await file.ensureVs();
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
      const resource = grantResource(id, parts);
      const granted = ctx.req.query.exp
        ? grant.verify(ctx.sess, resource, ctx.req.query) === "ok"
        : await grant.verify(ctx.app, permanentResource(resource, f.vs?.md5), ctx.req.query) === "ok";
      if (!granted && !await f.access()) return new Response(null, { status: 403 });
    }

    let mime = f.mime || typeByExtension(f.extension) || "application/octet-stream";

    const headers = new Headers();

    const mtime = await f.mtime();
    if (mtime !== undefined) headers.set("Last-Modified", new Date(mtime * 1000).toUTCString());
    const maxAge = 60 * 60 * 24 * 180;
    headers.set("Cache-Control", `max-age=${maxAge}, private, immutable`);

    const { path: outputPath, mime: outputMime, key, transformed, error } = await f.transform(params);
    if (error && isTransformRequest(params)) return new Response(error.message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    mime = outputMime || mime;

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

    // Security
    if (/^(text\/html|application\/xhtml\+xml)/.test(mime)) mime = "text/plain";
    if (mime === "image/svg+xml") headers.set("Content-Security-Policy", "script-src 'none'");
    headers.set("X-Content-Type-Options", "nosniff");

    if (mime === "image/svg+xml" || mime === "text/markdown") mime += "; charset=utf-8";
    headers.set("Content-Type", mime);

    // Cache key as ETag (content identity) – cache-file mtime is unusable, it gets touched for LRU tracking
    const etag = `"qg${key ?? String((await Deno.stat(outputPath).catch(() => null))?.mtime?.getTime() ?? 0)}"`;
    headers.set("ETag", etag);
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    headers.set("Accept-Ranges", "bytes");
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const range = await openRange(outputPath, rangeHeader);
      if (range) {
        headers.set("Content-Range", range.contentRange);
        headers.set("Content-Length", String(range.length));
        return new Response(range.stream, { status: 206, headers });
      }
    }

    const file = await Deno.open(outputPath, { read: true });
    headers.set("Content-Length", String((await file.stat()).size));
    return new Response(file.readable, { status: 200, headers });
  }
}

export class DbFile extends File {
  #manager: DbFileManager;
  id: number;
  vs?: Record<string, any>;

  constructor(manager: DbFileManager, id: number | string) {
    super("");
    this.#manager = manager;
    this.id = Number(id);
  }

  override get extension(): string { return String(this.vs?.name ?? "").replace(/.*\./, "").toLowerCase(); }

  override get mime(): string { return this.vs?.mime ?? ""; }

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
      if (this.vs.md5) this.path = this.#manager.directory + this.vs.md5;
    }
    return this.vs!;
  }

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
    if (!e.access) await this.#manager.app.fire("dbFile:access-fallback", e);  // slow path only when still unresolved
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
    // Deferred: a blob is the only unrecoverable data, so never unlink before the transaction committed.
    await db.afterCommit(async () => {
      const still = await db.one`SELECT id FROM ${sql.id(tableRef("file"))} WHERE md5 = ${md5}`;
      if (!still) await Deno.remove(this.#manager.directory + md5).catch(() => {});
    });
  }

  async replaceBy(path: string) {
    if (/^(https?|data):/.test(path)) {
      const maxSize = await this.#manager.app.settings.core.uploadMaxFileSize as number;
      const src = path.startsWith("data:") ? await readDataUrl(path, { maxSize }) : await fetchRemoteFile({ url: path, maxSize });
      this.path = this.#manager.directory + src.md5;
      await Deno.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
      await moveFile(src.tmpPath, this.path);
      await this.setVs({ name: src.name, mime: src.type, text: await this.getText(), md5: src.md5, size: src.size });
      return;
    }
    const src = new File(path);

    const md5 = await src.md5();
    this.path = this.#manager.directory + md5;
    await Deno.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    if (!await src.copyTo(this.path)) throw new Error(`Copy failed: ${path} → ${this.path}`);

    await this.setVs({ name: src.basename(), mime: src.mime, text: await src.getText(), md5, size: await this.size() });
  }

  async replaceFromUpload(f: UploadedFile) {
    this.path = this.#manager.directory + f.md5;
    await Deno.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    await moveFile(f.tmpPath, this.path);

    const ext = f.name.replace(/.*\./, "").toLowerCase();
    let type = f.type;
    if (type === "application/octet-stream") type = typeByExtension(ext) ?? "application/octet-stream";
    type = type.replace(/;.*/, "");

    await this.setVs({ name: f.name, mime: type, md5: f.md5, size: await this.size(), text: await this.getText() });
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
    return this.#manager.file(to, data);
  }

  async transform(param: Record<string, unknown>): Promise<{ path: string; mime: string; key?: string; transformed?: boolean; error?: Error }> {
    await this.ensureVs();
    if (!this.path) return { path: this.path, mime: this.mime };
    const dbMime = this.mime;
    const result = await this.#manager.app.fileTransformer.transform(this.path, parseTransformOptions(param), dbMime);
    return { path: result.path, mime: result.mime || dbMime, key: result.key, transformed: result.transformed, error: result.error };
  }

  override toString(): string { return String(this.id); }

}

function grantResource(id: number, parts: string[]): string {
  return `dbFile\0${id}/${parts.join("/")}`;
}

function permanentResource(resource: string, md5: unknown): string {
  return `${resource}\0${String(md5 ?? "")}`;
}

function parseTransformOptions(param: Record<string, unknown>): TransformOptions {
  const opt: TransformOptions = { fmt: param.fmt as TransformOptions['fmt'] };
  const bool = (k: string) => k in param ? param[k] !== 'false' && param[k] !== '0' : undefined;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  for (const k of ['w', 'h', 'q', 'vpos', 'hpos', 'zoom', 'dpr', 'page', 'frame'] as const)
    opt[k] = k in param ? num(param[k]) : undefined;
  opt.max = bool('max');
  return opt;
}

function isTransformRequest(param: Record<string, unknown>): boolean {
  return ['fmt', 'w', 'h', 'q', 'vpos', 'hpos', 'zoom', 'dpr', 'page', 'frame', 'max'].some((k) => k in param);
}

/** Stream a single `bytes=` range of a file; null = serve the full file instead. */
async function openRange(filePath: string, rangeHeader: string) {
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/); // multi-range unsupported
  if (!m || (!m[1] && !m[2])) return null;
  const file = await Deno.open(filePath, { read: true }).catch(() => null);
  if (!file) return null;
  try {
    const size = (await file.stat()).size;
    const start = m[1] === "" ? Math.max(size - Number(m[2]), 0) : Number(m[1]); // `-n` = last n bytes
    const end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { file.close(); return null; }
    await file.seek(start, Deno.SeekMode.Start);
    const length = end - start + 1;
    let remaining = length;
    const stream = file.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk.subarray(0, Math.min(chunk.byteLength, remaining)));
        remaining -= Math.min(chunk.byteLength, remaining);
        if (remaining === 0) controller.terminate(); // cancels the source, closing the file
      },
    }));
    return { stream, length, contentRange: `bytes ${start}-${end}/${size}` };
  } catch { file.close(); return null; }
}
