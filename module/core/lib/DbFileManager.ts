// deno-lint-ignore-file no-explicit-any

import * as nodeFs from "node:fs/promises";
import * as nodeCrypto from "node:crypto";
import { Hono } from "../../../deps.ts";
import { File } from "./File.ts";
import { typeByExtension } from "../../../deps.ts";
import { FileTransformer, type TransformOptions } from "./transform/index.ts";
import { DB } from "./db.ts";
import { getCtx } from "./context.ts";
import type { App } from "../server.ts";

export class DbFileManager {
  #cache: Record<string, DbFile> = {};
  app: App;
  db: DB;
  directory: string;
  baseURL = "";
  router: Hono = new Hono();

  constructor(app: App, directory: string) {
    this.app = app;
    this.db = app.db;
    this.directory = directory.endsWith("/") ? directory : directory + "/";
    this.router.all("/:path{.*}", (c) => this.output(c.req.param("path"), c.req.raw));
    Deno.mkdir(this.directory, { recursive: true }).catch(() => {});
  }

  file(id: number | string, vs?: any): DbFile {
    const key = String(id);
    return this.#cache[key] ??= new DbFile(this, id, vs);
  }

  clearCache(id?: number | string) {
    if (id !== undefined) {
      delete this.#cache[String(id)];
    } else {
      this.#cache = {};
    }
  }

  async add(path?: string): Promise<DbFile> {
    const id = parseInt(String(await this.db.table("file").insert({}) ?? "0"));
    const f = this.file(id);
    if (path) await f.replaceBy(path);
    return f;
  }

  async output(request: string, req: Request): Promise<Response> {
    const x = request.split("/");
    const id = parseInt(x.shift() ?? "0");
    const name = x.pop() ?? "";

    const param: Record<string, any> = {};
    for (const value of x) {
      const y = value.split("-");
      param[y[0]] = y[1] ?? true;
    }

    const F = this.file(id);
    await F._loadVs();

    if (!await F.exists()) return new Response(null, { status: 404 });
    if (!await F.access()) return new Response(null, { status: 401 });

    let mime = F.mime() || typeByExtension(F.extension()) || "application/octet-stream";
    if (mime === "image/svg+xml") mime += "; charset=utf-8";

    const headers = new Headers();

    const mtime = await F.mtime();
    if (mtime !== false) {
      headers.set("Last-Modified", new Date(mtime * 1000).toUTCString());
    }
    const maxAge = 60 * 60 * 24 * 180;
    const expires = Math.floor(Date.now() / 1000) + maxAge;
    headers.set("Expires", new Date(expires * 1000).toUTCString());
    headers.set("Cache-Control", `max-age=${maxAge}, private, immutable`);
    headers.set("Pragma", "private");

    const transformed = await F.transform(param);
    const outputPath = transformed.path;
    mime = transformed.mime || mime;

    if (/\.pdf$/.test(name) || mime === "application/pdf") {
      mime = "application/pdf";
      headers.set("Content-Disposition", `inline; filename="${await F.name()}"`);
      headers.set("Expires", "0");
      headers.set("Cache-Control", "must-revalidate");
    }

    if ("dl" in param) {
      mime = "application/force-download";
      headers.set("Expires", "0");
      headers.set("Cache-Control", "private, must-revalidate");
      headers.set("Content-Disposition", `attachment; filename="${await F.name()}"`);
      headers.set("Content-Transfer-Encoding", "binary");
    }

    if ("as" in param && param["as"] === "text") mime = "text/plain";

    headers.set("Content-Type", mime);

    const outputStat = await Deno.stat(outputPath).catch(() => null);
    const etag = "qg" + String(outputStat?.mtime?.getTime() ?? 0);
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
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
  public id: number;
  public vs: Record<string, any>;

  constructor(manager: DbFileManager, id: number | string, vs?: any) {
    super("");
    this.#manager = manager;
    this.id = parseInt(String(id));
    this.vs = vs ?? {};
    if (this.vs?.["md5"]) {
      this.path = this.#manager.directory + this.vs["md5"];
    }
  }

  async get(field: string): Promise<unknown> {
    await this._loadVs();
    return this.vs[field];
  }

  async _loadVs() {
    if (this.id && (!this.vs || !Object.keys(this.vs).length)) {
      this.vs = await this.#manager.db.row(`SELECT * FROM file WHERE id = ?`, [this.id]) ?? {};
      if (this.vs["md5"]) {
        this.path = this.#manager.directory + this.vs["md5"];
      }
    }
  }

  setVs(vs: Record<string, any>) {
    this.#manager.db.table("file").update(this.id, vs);
    if (!this.vs) return;
    this.vs = { ...this.vs, ...vs };
    if (this.vs["md5"]) {
      this.path = this.#manager.directory + this.vs["md5"];
    }
  }

  override async url(params: Record<string, any> | null = null): Promise<string> {
    await this._loadVs();
    const noNome = params == null; // backwards compatibility: if params is null, include name in URL; if params is an empty object, exclude name
    params = params ?? {};
    params["u"] = String(this.vs["md5"] ?? "").slice(0, 4);
    const paramStr = Object.entries(params).map(([k, v]) => `${k}-${v}`).join("/");
    const baseURL = getCtx().appURL + "dbFile/";
    if (noNome) return baseURL + this.id + "/" + paramStr;
    return baseURL + this.id + "/" + paramStr + "/" + encodeURIComponent(await this.name());
  }

  async access(set?: any): Promise<boolean> {
    await this._loadVs();
    if (set === undefined) {
      const access = this.vs["access"] == "1";
      const e = { File: this, access };
      await this.#manager.app.fire("dbFile::access", e);
      await this.#manager.app.fire("dbFile::access2", e);
      return e.access;
    }
    this.setVs({ access: set ? 1 : 0 });
    return !!set;
  }

  async name(): Promise<string>;
  async name(set?: any): Promise<string | void> {
    await this._loadVs();
    if (set === undefined) return this.vs["name"] ?? "";
    this.setVs({ name: set });
  }

  override extension(): string {
    return String(this.vs["name"] ?? "").replace(/.*\./, "").toLowerCase();
  }

  override mime(): string {
    return this.vs["mime"] ?? "";
  }

  async updateDb() {
    await this._loadVs();
    this.path = this.#manager.directory + this.vs["md5"];
    this.setVs({ text: await this.getText(), size: await this.size() });
  }

  override toString(): string {
    return String(this.id);
  }

  async used(): Promise<boolean> {
    await this._loadVs();
    const tbl = this.#manager.db.table("file");
    for (const Field of tbl.children) {
      const sql = `SELECT 1 FROM ${DB.escapeId(Field.Table.name)} WHERE ${DB.escapeId(Field.name)} = ? LIMIT 1`;
      const has = await this.#manager.db.one(sql, [this.id]);
      if (has) return true;
    }
    const e = { dbFile: this, used: false };
    //await qg.fire("dbFile-used", e);
    return e.used;
  }

  async remove() {
    await this._loadVs();
    await this.#manager.db.table("file").delete(this.id);
    const e = { dbFile: this, prevent: false };
//await qg.fire("dbFile-remove-fs", e);
    const md5 = this.vs["md5"];
    this.path = "";
    if (e.prevent) return;
    if (md5) {
      const still = await this.#manager.db.one(`SELECT id FROM file WHERE md5 = ?`, [md5]);
      if (!still && this.path) {
        await nodeFs.unlink(this.path).catch(() => {});
      }
    }
  }

  async replaceBy(path: string) {
    let F: File;

    if (/^https?:\/\//.test(path)) {
      const resp = await fetch(path, { redirect: "follow" });
      const content = new Uint8Array(await resp.arrayBuffer());
      let basename = path.replace(/\?.*/, "").split("/").pop() ?? "file";
      const m = (resp.headers.get("content-disposition") ?? "").match(/filename="([^"]+)"/);
      if (m?.[1]) basename = m[1];
      const tmpDir = this.#manager.app.appPATH + "cache/tmp/";
      await nodeFs.mkdir(tmpDir, { recursive: true }).catch(() => {});
      const tmpPath = tmpDir + basename.replace(/\?.*/, "");
      await nodeFs.writeFile(tmpPath, content);
      F = new File(tmpPath);
    } else {
      F = new File(path);
    }

    const md5 = await F.md5();
    this.path = this.#manager.directory + md5;
    await nodeFs.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    await F.copyTo(this.path);

    this.setVs({ name: F.basename(), mime: F.mime(), text: await F.getText(), md5, size: await this.size() });
  }

  async replaceFromUpload(f: any) {
    const data: Uint8Array = f["data"] ?? new Uint8Array();
    const hash = nodeCrypto.createHash("md5").update(data).digest("hex");

    this.path = this.#manager.directory + hash;
    await Deno.mkdir(this.#manager.directory, { recursive: true }).catch(() => {});
    await Deno.writeFile(this.path, data);

    const ext = String(f["name"] ?? "").replace(/.*\./, "").toLowerCase();
    
    let type = String(f["type"] ?? "");
    if (type === "application/octet-stream") type = typeByExtension(ext) ?? "application/octet-stream";
    type = type.replace(/;.*/, "");

    this.vs["md5"] = hash;
    this.setVs({ name: f["name"] ?? "", mime: type, md5: hash, size: await this.size(), text: await this.getText() });
  }

  async clone(to?: number | null): Promise<DbFile> {
    await this._loadVs();
    const data = { ...this.vs };
    let newId: number;
    if (to == null) {
      delete data["id"];
      newId = parseInt(String(await this.#manager.db.table("file").insert(data) ?? "0"));
    } else {
      data["id"] = String(to);
      await this.#manager.db.table("file").update(to, data);
      newId = to;
      this.#manager.clearCache(to);
    }
    return this.#manager.file(newId);
  }

  async transform(param: Record<string, any>): Promise<{ path: string; mime: string }> {
    await this._loadVs();
    if (!this.path) return { path: this.path, mime: this.mime() };
    const cacheDir = this.#manager.app.appPATH + "cache/pri/";
    const dbMime = this.mime();
    const result = await FileTransformer.transform(this.path, cacheDir, parseTransformOptions(param), dbMime);
    return { path: result.path, mime: result.mime || dbMime };
  }
}

function parseTransformOptions(param: Record<string, any>): TransformOptions {
  const num = (k: string) => k in param ? Number(param[k]) : undefined;
  const bool = (k: string) => k in param ? param[k] !== 'false' && param[k] !== '0' : undefined;
  return {
    w:    num('w'),
    h:    num('h'),
    q:    num('q'),
    vpos: num('vpos'),
    hpos: num('hpos'),
    zoom: num('zoom'),
    dpr:  num('dpr'),
    page:  num('page'),
    frame: num('frame'),
    max:   bool('max'),
    fmt:  param['fmt'] as TransformOptions['fmt'],
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
