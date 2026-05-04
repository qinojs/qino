/**
 * File.ts - File management
 * Port of core/lib/File.class.php
 */

import * as nodeCrypto from "node:crypto";
import { typeByExtension } from "../../../deps.ts";

export class File {
  public path: string;

  constructor(path: string) {
    this.path = path;
  }

  toString(): string {
    return this.path;
  }

  read(): void {
    // In Deno context: read is used to stream a file; callers use ctx.state.__fileOutput
    // This method exists for API compatibility
  }

  async contents(set?: string | Uint8Array | null): Promise<string | number> {
    if (set == null) return await Deno.readTextFile(this.path);
    await (typeof set === "string" ? Deno.writeTextFile(this.path, set) : Deno.writeFile(this.path, set));
    return set.length;
  }

  basename(suffix = ""): string {
    const base = this.path.split(/[\\/]/).pop() || "";
    if (suffix && base.endsWith(suffix)) {
      return base.slice(0, -suffix.length);
    }
    return base;
  }

  async copyTo(dest: string): Promise<boolean> {
    try {
      await Deno.copyFile(this.path, dest);
      return true;
    } catch {
      return false;
    }
  }

  async exists(): Promise<this | false> {
    if (!this.path) return false;
    try {
      const stat = await Deno.stat(this.path);
      return stat.isFile ? this : false;
    } catch {
      return false;
    }
  }

  async mtime(): Promise<number | false> {
    try {
      const stat = await Deno.stat(this.path);
      return stat.mtime ? Math.floor(stat.mtime.getTime() / 1000) : false;
    } catch {
      return false;
    }
  }

  async size(): Promise<number> {
    try {
      return (await Deno.stat(this.path)).size;
    } catch {
      return 0;
    }
  }

  extension(): string {
    return this.path.replace(/.*\./, "").toLowerCase();
  }

  mime(): string {
    const ext = this.extension();
    return typeByExtension(ext) || "application/octet-stream";
  }

  url(): string | Promise<string> {
    // not universally useful in Deno context
    return this.path;
  }

  #uploadTicket?: string;

  async md5(): Promise<string> {
    try {
      const data = await Deno.readFile(this.path);
      return nodeCrypto.createHash("md5").update(data).digest("hex");
    } catch {
      return "";
    }
  }

  async getText(): Promise<string> {
    if (!await this.exists()) return "";
    const ext = this.extension();
    switch (ext) {
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

}
