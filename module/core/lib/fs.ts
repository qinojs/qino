import { access, copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, rmdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Stats } from "node:fs";

// deno-lint-ignore no-explicit-any
const { Bun, Deno } = globalThis as any;

/** Paths may come from requests, so the cache is limited. */
const MAX = 10_000;

/** Like `Deno.FileInfo`: flags are properties, not methods. */
const toInfo = (s: Stats) => ({
  isFile: s.isFile(),
  isDirectory: s.isDirectory(),
  size: s.size,
  mtime: s.mtime as Date | null,
  atime: s.atime as Date | null,
});
// deno-lint-ignore no-explicit-any
const pick = ({ isFile, isDirectory, size, mtime, atime }: any): Info => ({ isFile, isDirectory, size, mtime, atime });
type Info = ReturnType<typeof toInfo>;
type Opt = { ttl?: number };

// Absolute paths, so tenants don't mix. Concurrent calls share one stat promise.
const cache = new Map<string, { info: Promise<Info | undefined>; t: number }>();

const put = (path: string, info: Promise<Info | undefined>) => {
  cache.delete(path); // re-insert: map order = eviction order
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(path, { info, t: performance.now() });
};
/** A path and everything below it — for operations that change a whole tree. */
const forgetTree = (path: string) => {
  cache.delete(path);
  const dir = path.endsWith("/") ? path : path + "/";
  for (const key of cache.keys()) if (key.startsWith(dir)) cache.delete(key);
};

/** File operations for Deno, Bun and Node, with a cached stat like PHP: changes made here are
 *  seen at once, others (subprocesses, other processes, manual edits) after `ttl`. Use
 *  `{ ttl: 0 }` where those matter. Names follow Deno. */
export const fs = {
  /** How long a stat is reused (ms), read on every stat; `{ ttl: 0 }` bypasses the cache. */
  ttl: (): number => 300_000,

  // --- info (cached) ---

  /** Like `Deno.stat`, but undefined if missing. */
  stat(path: string, opt: Opt = {}): Promise<Info | undefined> {
    const hit = cache.get(path);
    if (hit && performance.now() - hit.t < (opt.ttl ?? fs.ttl())) return hit.info;
    const info = (Deno ? Deno.stat(path).then(pick) : stat(path).then(toInfo)).catch(() => undefined);
    put(path, info);
    return info;
  },
  /** Is there a file (not a directory)? */
  async isFile(path: string, opt?: Opt): Promise<boolean> {
    return !!(await fs.stat(path, opt))?.isFile;
  },
  /** Modification time in ms. */
  async mtime(path: string, opt?: Opt): Promise<number | undefined> {
    return (await fs.stat(path, opt))?.mtime?.getTime();
  },
  async size(path: string, opt?: Opt): Promise<number | undefined> {
    return (await fs.stat(path, opt))?.size;
  },
  /** Can this process write the file? Not cached. On Deno it tries an open for writing (no
   *  truncate), since `access` would need sys permission for the uid. */
  writable(path: string): Promise<boolean> {
    if (Deno) return Deno.open(path, { write: true }).then((f: { close(): void }) => (f.close(), true), () => false);
    return access(path, constants.W_OK).then(() => true, () => false);
  },

  // --- read ---

  text(path: string): Promise<string> {
    return Deno ? Deno.readTextFile(path) : readFile(path, "utf8");
  },
  bytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return Deno ? Deno.readFile(path) : readFile(path) as Promise<Uint8Array<ArrayBuffer>>; // never shared
  },
  /** As stream, optionally a byte range (`end` inclusive, like HTTP). A missing file throws
   *  here, not later while reading. */
  async stream(path: string, { start, end }: { start?: number; end?: number } = {}): Promise<ReadableStream<Uint8Array>> {
    if (Bun) {
      const f = Bun.file(path);
      if (!await f.exists()) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
      return f.slice(start, end === undefined ? undefined : end + 1).stream();
    }
    if (Deno && start === undefined && end === undefined) return (await Deno.open(path)).readable;
    return Readable.toWeb((await open(path)).createReadStream({ start, end })) as ReadableStream<Uint8Array>;
  },
  /** Like `Deno.readDir`, as an array — works with `for` and `for await`. */
  async list(dir: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    return (await readdir(dir, { withFileTypes: true })).map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
    }));
  },

  // --- write (updates the cache) ---

  /** A stream is piped chunk by chunk. `createNew` fails if the file exists. */
  async write(path: string, data: string | Uint8Array | ReadableStream<Uint8Array>, { createNew = false } = {}): Promise<void> {
    const stream = data instanceof ReadableStream;
    const flags = createNew ? "wx" : "w";
    try {
      if (Deno) await (typeof data === "string" ? Deno.writeTextFile : Deno.writeFile)(path, data, { createNew });
      // Bun.write has no flags; createPath: false keeps missing parents an error, like elsewhere
      else if (Bun && !createNew) await Bun.write(path, stream ? new Response(data) : data, { createPath: false });
      else if (stream) await data.pipeTo(Writable.toWeb(createWriteStream(path, { flags })));
      else await writeFile(path, data, { flag: flags });
    } finally {
      cache.delete(path);
    }
  },
  /** Always recursive; an existing directory is fine. */
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
    cache.delete(path);
  },
  /** Missing is fine. A file or empty directory, like `Deno.remove`; `recursive` removes content too. */
  async remove(path: string, { recursive = false } = {}): Promise<void> {
    await rm(path, { force: true, recursive }).catch((e) => {
      // rm refuses directories without `recursive` (Bun: EFAULT); rmdir removes empty ones
      if (recursive || !["ERR_FS_EISDIR", "EISDIR", "EFAULT"].includes(e.code)) throw e;
      return rmdir(path);
    });
    forgetTree(path);
  },
  /** Works across devices (copy + remove). */
  async rename(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch (e) {
      if ((e as { code?: string }).code !== "EXDEV") throw e;
      await copyFile(from, to);
      await rm(from, { force: true });
    } finally {
      forgetTree(from);
      forgetTree(to);
    }
  },
  async copy(from: string, to: string): Promise<void> {
    await copyFile(from, to);
    cache.delete(to);
  },
  async symlink(target: string, path: string): Promise<void> {
    await symlink(target, path);
    cache.delete(path);
  },
  /** Set the modification time to now. */
  async touch(path: string): Promise<void> {
    const now = new Date();
    await utimes(path, now, now);
    cache.delete(path);
  },

  // --- temp (like Deno.makeTempFile / makeTempDir) ---

  /** New empty file in the system temp dir or `dir`. Deno's own needs no env access for TMPDIR. */
  async tempFile({ prefix = "", dir }: { prefix?: string; dir?: string } = {}): Promise<string> {
    if (Deno) return Deno.makeTempFile({ prefix, dir });
    const path = join(dir ?? tmpdir(), prefix + crypto.randomUUID());
    await writeFile(path, "", { flag: "wx" });
    return path;
  },
  tempDir({ prefix = "", dir }: { prefix?: string; dir?: string } = {}): Promise<string> {
    return Deno ? Deno.makeTempDir({ prefix, dir }) : mkdtemp(join(dir ?? tmpdir(), prefix));
  },
};
