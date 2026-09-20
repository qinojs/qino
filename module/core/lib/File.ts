import * as nodeCrypto from "node:crypto";

import { typeByExtension } from "../deps.ts";

export class File {
  path: string;

  constructor(path: string) {
    this.path = path;
  }

  get extension(): string {
    return this.path.replace(/.*\./, "").toLowerCase();
  }

  get mime(): string {
    return typeByExtension(this.extension) || "application/octet-stream";
  }

  basename(suffix = ""): string {
    const base = this.path.split(/[\\/]/).pop() ?? "";
    return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
  }

  copyTo(dest: string): Promise<boolean> {
    return Deno.copyFile(this.path, dest).then(() => true, () => false);
  }

  async exists(): Promise<this | undefined> {
    if (!this.path) return;
    const stat = await Deno.stat(this.path).catch(() => null);
    return stat?.isFile ? this : undefined;
  }

  async mtime(): Promise<number | undefined> {
    const stat = await Deno.stat(this.path).catch(() => null);
    return stat?.mtime ? Math.floor(stat.mtime.getTime() / 1000) : undefined;
  }

  async size(): Promise<number> {
    const stat = await Deno.stat(this.path).catch(() => null);
    return stat?.size ?? 0;
  }

  async md5(): Promise<string> {
    const file = await Deno.open(this.path).catch(() => null);
    if (!file) return "";
    const hash = nodeCrypto.createHash("md5");
    // streamed: a big file must not land in memory. A directory opens fine and only throws here.
    try { for await (const chunk of file.readable) hash.update(chunk); } catch { return ""; }
    return hash.digest("hex");
  }

  toString(): string { return this.path; }

}
