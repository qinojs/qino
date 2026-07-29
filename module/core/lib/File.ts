import * as nodeCrypto from "node:crypto";
import { typeByExtension } from "../../../deps.ts";

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

  async contents(set?: string | Uint8Array | null): Promise<string | number> {
    if (set == null) return Deno.readTextFile(this.path);
    await (typeof set === "string" ? Deno.writeTextFile(this.path, set) : Deno.writeFile(this.path, set));
    return set.length;
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
    const data = await Deno.readFile(this.path).catch(() => null);
    return data ? nodeCrypto.createHash("md5").update(data).digest("hex") : "";
  }

  async getText(): Promise<string> {
    if (!await this.exists()) return "";
    switch (this.extension) {
      case "csv":
      case "txt":
        return String(await this.contents());
      case "php":
      case "htm":
      case "html":
        return String(await this.contents()).replace(/<[^>]+>/g, "");
      default:
        return "";
    }
  }

  toString(): string { return this.path; }

}
