import * as nodeCrypto from "node:crypto";

import { typeByExtension } from "../deps.ts";
import { fs } from "./fs.ts";

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
    return fs.copy(this.path, dest).then(() => true, () => false);
  }

  async exists(): Promise<this | undefined> {
    if (!this.path) return;
    return await fs.isFile(this.path) ? this : undefined;
  }

  async mtime(): Promise<number | undefined> {
    const ms = await fs.mtime(this.path);
    return ms === undefined ? undefined : Math.floor(ms / 1000);
  }

  async size(): Promise<number> {
    return await fs.size(this.path) ?? 0;
  }

  async md5(): Promise<string> {
    const stream = await fs.stream(this.path).catch(() => null);
    if (!stream) return "";
    const hash = nodeCrypto.createHash("md5");
    // streamed, so big files don't fill memory. A directory opens fine and only throws here.
    try { for await (const chunk of stream) hash.update(chunk); } catch { return ""; }
    return hash.digest("hex");
  }

  toString(): string { return this.path; }

}
