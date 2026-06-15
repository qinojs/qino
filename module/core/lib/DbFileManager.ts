// deno-lint-ignore-file no-explicit-any

import * as nodeFs from "node:fs/promises";
import { typeByExtension } from "../../../deps.ts";
import { File } from "./File.ts";
import { FileTransformer, type TransformOptions } from "./transform/index.ts";
import { Db } from "./Db.ts";
import { getCtx } from "./RequestContext.ts";
import { tableRef, scopeCache } from "./dbScope.ts";
import { fetchRemoteFile, type UploadedFile } from "./fileStream.ts";
import type { App } from "./App.ts";
import { contentDisposition } from "./util.ts";

export class DbFileManager {
  #cache: Record<string, DbFile> = {};
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

  async file(id: number | string, vs?: any): Promise<DbFile> {
    const key = String(id);
    const cache = scopeCache(this.#cache, "dbFiles", () => ({} as Record<string, DbFile>));
    cache[key] ??= new DbFile(this, id);
    if (vs) cache[key].setLocalVs(vs);
    else await cache[key].ensureVs();
    return cache[key];
  }

  clearCache(id?: number | string) {
    if (id !== undefined) delete this.#cache[String(id)];
    else this.#cache = {};
  }

  async add(path?: string): Promise<DbFile> {
    const id = Number(await this.db.table("file").insert({}) ?? "0");
    const f = await this.file(id);
    if (path) await f.replaceBy(path);
    return f;
  }

  async output(request: string, req: Request): Promise<Response> {
    const x = request.split("/");
    const id = Number(x.shift() ?? "0");
    const name = x.pop() ?? "";

    const param: Record<string, string | true> = {};
    for (const value of x) {
      const y = value.split("-");
      param[y[0]] = y[1] ?? true;
    }

    const F = await this.file(id);
    if (!await F.exists()) return new Response(null, { status: 404 });
    if (!await F.access()) return new Response(null, { status: 401 });

    let mime = F.mime || typeByExtension(F.extension) || "application/octet-stream";
    if (mime === "image/svg+xml") mime += "; charset=utf-8";

    const headers = new Headers();

    const mtime = await F.mtime();
    if (mtime !== false) {
      headers.set("Last-Modified", new Date(mtime * 1000).toUTCString());
    }
    const maxAge = 60 * 60 * 24 * 180;
    headers.set("Expires", new Date(Date.now() + maxAge * 1000).toUTCString());
    headers.set("Cache-Control", `max-age=${maxAge}, private, immutable`);
    headers.set("Pragma", "private");

    const transformed = await F.transform(param);
    const outputPath = transformed.path;
    mime = transformed.mime || mime;

    if (/\.pdf$/.test(name) || mime === "application/pdf") {
      mime = "application/pdf";
      headers.set("Content-Disposition", contentDisposition("inline", F.name));
      headers.set("Expires", "0");
      headers.set("Cache-Control", "must-revalidate");
    }

    if ("dl" in param) {
      mime = "application/force-download";
      headers.set("Expires", "0");
      headers.set("Cache-Control", "private, must-revalidate");
      headers.set("Content-Disposition", contentDisposition("attachment", F.name));
      headers.set("Content-Transfer-Encoding", "binary");
    }

    if ("as" in param && param["as"] === "text") mime = "text/plain";

    // Security
    if (/^(text\/html|application\/xhtml\+xml)/.test(mime)) mime = "text/plain";
    if (mime === "image/svg+xml") headers.set("Content-Security-Policy", "script-src 'none'");
    headers.set("X-Content-Type-Options", "nosniff");

    headers.set("Content-Type", mime);

    const outputStat = await Deno.stat(outputPath).catch(() => null);

    const etag = "qg" + String(outputStat?.mtime?.getTime() ?? 0);
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    headers.set("ETag", etag);

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const rangeData = await xStream(outputPath, rangeHeader);
      if (rangeData) {
        headers.set("Content-Range", rangeData.contentRange);
        headers.set("Content-Length", String(rangeData.data.length));
        headers.set("Accept-Ranges", "bytes");
        return new Response(rangeData.data, { status: 206, headers });
      }
    }

    const file = await Deno.open(outputPath, { read: true });
    headers.set("Content-Length", String((await file.stat()).size));
    headers.set("Accept-Ranges", "bytes");
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

  override get extension(): string { return String(this.vs?.["name"] ?? "").replace(/.*\./, "").toLowerCase(); }

  override get mime(): string { return this.vs?.["mime"] ?? ""; }

  get name(): string { return this.vs?.["name"] ?? ""; }

  set name(value: string) {
    if (this.vs) this.vs["name"] = value;
    this.setVs({ name: value }).catch(console.error);
  }

  setLocalVs(vs: Record<string, any>) {
    this.vs = vs;
    this.path = vs["md5"] ? this.#manager.directory + vs["md5"] : "";
  }

  async ensureVs(): Promise<Record<string, any>> {
    if (this.id && !this.vs) {
      this.vs = await this.#manager.db.row(`SELECT * FROM \`${tableRef("file")}\` WHERE id = ?`, [this.id]) ?? {};
      if (this.vs["md5"]) this.path = this.#manager.directory + this.vs["md5"];
    }
    return this.vs!;
  }

  async get(field: string): Promise<any> { return (await this.ensureVs())[field]; }

  override async exists(): Promise<this | false> { await this.ensureVs(); return super.exists(); }

  async setVs(vs: Record<string, any>) {
    await this.#manager.db.table("file").update(this.id, vs);
    if (this.vs) {
      Object.assign(this.vs, vs);
      if (this.vs["md5"]) this.path = this.#manager.directory + this.vs["md5"];
    }
  }

  async url(params: Record<string, any> = {}): Promise<string> {
    const vs = await this.ensureVs();
    const u = `u-${String(vs["md5"] ?? "").slice(0, 5)}`;
    const parts = [u, ...Object.entries(params).map(([k, v]) => v === true || k === "max" ? k : `${k}-${v}`)];
    const baseURL = getCtx().appURL + "dbFile/";
    return baseURL + this.id + "/" + parts.join("/") + "/" + encodeURIComponent(this.name);
  }

  async access(set?: any): Promise<boolean> {
    if (set !== undefined) { await this.setVs({ access: set ? 1 : 0 }); return !!set; }
    const vs = await this.ensureVs();
    const e = { File: this, access: vs["access"] == "1" };
    await this.#manager.app.fire("dbFile::access", e);
    await this.#manager.app.fire("dbFile::access2", e);
    return e.access;
  }

  async updateDb() {
    const vs = await this.ensureVs();
    this.path = this.#manager.directory + vs["md5"];
    await this.setVs({ text: await this.getText(), size: await this.size() });
  }

  async used(): Promise<boolean> {
    for (const Field of this.#manager.db.table("file").children) {
      const sql = `SELECT 1 FROM ${this.#manager.db.escapeId(Field.table.name)} WHERE ${this.#manager.db.escapeId(Field.name)} = ? LIMIT 1`;
      if (await this.#manager.db.one(sql, [this.id])) return true;
    }
    const e = { dbFile: this, used: false };
    await this.#manager.app.fire("dbFile-used", e);
    return e.used;
  }

  async remove() {
    const { md5 } = await this.ensureVs();
    await this.#manager.db.table("file").delete(this.id);
    const e = { dbFile: this, prevent: false };
    await this.#manager.app.fire("dbFile-remove-fs", e);
    this.path = "";
    if (e.prevent || !md5) return;
    const still = await this.#manager.db.one(`SELECT id FROM file WHERE md5 = ?`, [md5]);
    if (!still) await nodeFs.unlink(this.#manager.directory + md5).catch(() => {});
  }

  async replaceBy(path: string) {
    if (/^https?:\/\//.test(path)) {
      const remote = await fetchRemoteFile({
        url: path,
        maxSize: Number(await this.#manager.app.settings.core.uploadMaxFileSize ?? "") || 100 * 1024 * 1024,
      });
      this.path = this.#manager.directory + remote.md5;
      await Deno.rename(remote.tmpPath, this.path);
      await this.setVs({ name: remote.name, mime: remote.type, text: await this.getText(), md5: remote.md5, size: remote.size });
      return;
    }
    const F = new File(path);

    const md5 = await F.md5();
    this.path = this.#manager.directory + md5;
    await nodeFs.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    await F.copyTo(this.path);

    await this.setVs({ name: F.basename(), mime: F.mime, text: await F.getText(), md5, size: await this.size() });
  }

  async replaceFromUpload(f: UploadedFile) {
    this.path = this.#manager.directory + f.md5;
    await Deno.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    await Deno.rename(f.tmpPath, this.path);

    const ext = f.name.replace(/.*\./, "").toLowerCase();
    let type = f.type;
    if (type === "application/octet-stream") type = typeByExtension(ext) ?? "application/octet-stream";
    type = type.replace(/;.*/, "");

    await this.setVs({ name: f.name, mime: type, md5: f.md5, size: await this.size(), text: await this.getText() });
  }

  async clone(to?: number | null): Promise<DbFile> {
    const data = { ...await this.ensureVs() };
    let newId: number;
    if (to == null) {
      delete data["id"];
      newId = Number(await this.#manager.db.table("file").insert(data) ?? "0");
    } else {
      data["id"] = String(to);
      await this.#manager.db.table("file").update(to, data);
      newId = to;
      return this.#manager.file(newId, data);
    }
    return this.#manager.file(newId);
  }

  async transform(param: Record<string, unknown>): Promise<{ path: string; mime: string }> {
    await this.ensureVs();
    if (!this.path) return { path: this.path, mime: this.mime };
    const cacheDir = this.#manager.app.appPATH + "cache/pri/";
    const dbMime = this.mime;
    const result = await FileTransformer.transform(this.path, cacheDir, parseTransformOptions(param), dbMime);
    return { path: result.path, mime: result.mime || dbMime };
  }

  override toString(): string { return String(this.id); }

}

function parseTransformOptions(param: Record<string, unknown>): TransformOptions {
  const num = (k: string) => k in param ? Number(param[k]) : undefined;
  const bool = (k: string) => k in param ? param[k] !== 'false' && param[k] !== '0' : undefined;
  return {
    w:     num('w'),
    h:     num('h'),
    q:     num('q'),
    vpos:  num('vpos'),
    hpos:  num('hpos'),
    zoom:  num('zoom'),
    dpr:   num('dpr'),
    page:  num('page'),
    frame: num('frame'),
    max:   bool('max'),
    fmt:   param['fmt'] as TransformOptions['fmt'],
  };
}

async function xStream(filePath: string, rangeHeader: string) {
  try {
    const filestat = await Deno.stat(filePath);
    const filesize = filestat.size;
    const [param, rangeStr] = rangeHeader.split("=");
    if (param.trim() !== "bytes") return null;
    const ranges = rangeStr.split(",")[0].split("-");
    let start: number;
    let end: number;
    if (ranges[0] === "") {
      end = filesize - 1;
      start = end - parseInt(ranges[1]);
    } else if (ranges[1] === "") {
      start = parseInt(ranges[0]);
      end = filesize - 1;
    } else {
      start = parseInt(ranges[0]);
      end = parseInt(ranges[1]);
      if (end >= filesize || (!start && (!end || end === filesize - 1))) return null;
    }
    const length = end - start + 1;
    
    const file = await Deno.open(filePath, { read: true });
    await file.seek(start, Deno.SeekMode.Start);
    const buf = new Uint8Array(length);
    await file.read(buf);
    file.close();

    return { data: buf, contentRange: `bytes ${start}-${end}/${filesize}` };
  } catch {
    return null;
  }
}
