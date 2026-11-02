import { test } from "node:test";
import { chmod, rm, stat, utimes, writeFile } from "node:fs/promises";
import { assert, assertEquals, assertRejects } from "./deps.ts";
import { fs } from "../lib/fs.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

/** A fresh dir per test — the cache is module-wide, paths must not repeat. */
async function inDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.tempDir({ prefix: "qino-fs-" });
  try { await fn(dir); } finally { await fs.remove(dir, { recursive: true }); }
}

test("fs: stat, isFile, size, mtime; missing is undefined", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.stat(path), undefined);
  assertEquals(await fs.isFile(path), false);
  assertEquals(await fs.mtime(path), undefined);

  await fs.write(path, "hello");
  const info = await fs.stat(path);
  assertEquals(info?.isFile, true);
  assertEquals(info?.isDirectory, false);
  assertEquals(info?.size, 5);
  assert(info?.mtime instanceof Date);
  assert(info?.atime instanceof Date);
  assertEquals(await fs.size(path), 5);
  assertEquals(await fs.mtime(path), info?.mtime?.getTime());
  assertEquals(await fs.isFile(dir), false); // a directory is not a file
  assertEquals((await fs.stat(dir))?.isDirectory, true);
}));

test("fs: foreign writes stay unseen until ttl, own writes are seen at once", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.isFile(path), false);
  await writeFile(path, "foreign");
  assertEquals(await fs.isFile(path), false); // cached miss
  assertEquals(await fs.isFile(path, { ttl: 0 }), true);

  await rm(path);
  assertEquals(await fs.isFile(path), true); // cached hit
  await fs.write(path, "own");
  assertEquals(await fs.size(path), 3);
}));

test("fs: concurrent stats share one lookup", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "x");
  const a = fs.stat(path), b = fs.stat(path);
  assertEquals(a, b);
}));

test("fs: text, bytes, write with createNew", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "héllo");
  assertEquals(await fs.text(path), "héllo");
  await fs.write(path, new Uint8Array([1, 2, 3]));
  assertEquals([...await fs.bytes(path)], [1, 2, 3]);

  await assertRejects(() => fs.write(path, "x", { createNew: true }));
  await fs.write(dir + "/new.txt", "x", { createNew: true });
  assertEquals(await fs.text(dir + "/new.txt"), "x");
  await assertRejects(() => fs.write(dir + "/missing/a.txt", "x")); // parents are not created
  await assertRejects(() => fs.text(dir + "/nope.txt"));
}));

test("fs: write takes a stream", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, new Blob(["hello ", "world"]).stream());
  assertEquals(await fs.text(path), "hello world");
  await fs.write(path, new Blob(["x"]).stream()); // truncates
  assertEquals(await fs.text(path), "x");
}));

test("fs: stream, whole and as a range", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "hello world");
  assertEquals(await new Response(await fs.stream(path)).text(), "hello world");
  assertEquals(await new Response(await fs.stream(path, { start: 6, end: 10 })).text(), "world"); // end inclusive
  assertEquals(await new Response(await fs.stream(path, { start: 6 })).text(), "world");
}));

test("fs: a stream renews the stat from the open file", () => inDir(async (dir) => {
  await fs.write(dir + "/a", "old");
  assertEquals(await fs.size(dir + "/a"), 3);
  await writeFile(dir + "/a", "longer"); // a foreign write
  assertEquals(await fs.size(dir + "/a"), 3); // cached
  await (await fs.stream(dir + "/a")).cancel();
  assertEquals(await fs.size(dir + "/a"), 6);
}));

test("fs: stream of a missing file throws at once", () => inDir(async (dir) => {
  const err = await assertRejects(() => fs.stream(dir + "/nope.txt"));
  assertEquals((err as { code?: string }).code, "ENOENT");
  await assertRejects(() => fs.stream(dir + "/nope.txt", { start: 1 }));
}));

test("fs: list, mkdir", () => inDir(async (dir) => {
  await fs.mkdir(dir + "/sub/deep"); // parents too
  await fs.mkdir(dir + "/sub"); // existing is fine
  await fs.write(dir + "/a.txt", "x");
  const entries = (await fs.list(dir)).sort((a, b) => a.name.localeCompare(b.name));
  assertEquals(entries, [
    { name: "a.txt", isFile: true, isDirectory: false },
    { name: "sub", isFile: false, isDirectory: true },
  ]);
  await assertRejects(() => fs.list(dir + "/nope"));
}));

test("fs: remove forgets the path and everything below", () => inDir(async (dir) => {
  await fs.mkdir(dir + "/sub");
  await fs.write(dir + "/sub/a.txt", "x");
  assertEquals(await fs.isFile(dir + "/sub/a.txt"), true);
  await fs.remove(dir + "/sub", { recursive: true });
  assertEquals(await fs.isFile(dir + "/sub/a.txt"), false);
  await fs.remove(dir + "/nope.txt"); // missing is fine

  await fs.write(dir + "/b.txt", "x");
  assertEquals(await fs.isFile(dir + "/b.txt"), true);
  await fs.remove(dir + "/b.txt");
  assertEquals(await fs.isFile(dir + "/b.txt"), false);
}));

test("fs: remove takes an empty directory, not a full one", () => inDir(async (dir) => {
  await fs.mkdir(dir + "/empty");
  await fs.remove(dir + "/empty");
  assertEquals(await fs.stat(dir + "/empty"), undefined);

  await fs.mkdir(dir + "/full");
  await fs.write(dir + "/full/a.txt", "x");
  const err = await assertRejects(() => fs.remove(dir + "/full"));
  assertEquals((err as { code?: string }).code, "ENOTEMPTY");
}));

test("fs: rename, copy", () => inDir(async (dir) => {
  const a = dir + "/a.txt", b = dir + "/b.txt", c = dir + "/c.txt";
  await fs.write(a, "x");
  assertEquals(await fs.isFile(a), true);
  assertEquals(await fs.isFile(b), false);
  await fs.rename(a, b);
  assertEquals(await fs.isFile(a), false);
  assertEquals(await fs.text(b), "x");
  assertEquals(await fs.isFile(b), true);

  assertEquals(await fs.isFile(c), false);
  await fs.copy(b, c);
  assertEquals(await fs.isFile(c), true);
  assertEquals(await fs.text(c), "x");
  await assertRejects(() => fs.rename(dir + "/nope", dir + "/x"));
}));

// Deno grants symlink only with unscoped read and write — `deno task test` scopes write to /tmp.
const unscoped = (globalThis.Deno?.permissions.querySync({ name: "write" }).state ?? "granted") === "granted";

test("fs: symlink", { skip: !unscoped }, () => inDir(async (dir) => {
  const a = dir + "/a.txt", link = dir + "/link.txt";
  await fs.write(a, "x");
  assertEquals(await fs.isFile(link), false);
  await fs.symlink(a, link);
  assertEquals(await fs.isFile(link), true); // stat follows the link
  assertEquals(await fs.text(link), "x");
}));

test("fs: touch", () => inDir(async (dir) => {
  const a = dir + "/a.txt";
  await fs.write(a, "x");
  const old = new Date(2000, 0, 1);
  await utimes(a, old, old);
  assertEquals(await fs.mtime(a, { ttl: 0 }), old.getTime());
  await fs.touch(a);
  assert(await fs.mtime(a) as number > old.getTime());
}));

test("fs: writable", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "x");
  assertEquals(await fs.writable(path), true);
  assertEquals(await fs.writable(dir + "/nope.txt"), false);
  await chmod(path, 0o444);
  const root = (() => { try { return process.getuid?.() === 0; } catch { return false; } })(); // uid needs --allow-sys
  if (!root) assertEquals(await fs.writable(path), false); // root writes anyway
  assertEquals(await fs.text(path), "x"); // asking did not truncate
}));

test("fs: tempFile, tempDir", () => inDir(async (dir) => {
  const file = await fs.tempFile({ prefix: "t-", dir });
  assert(file.startsWith(dir + "/t-"));
  assertEquals(await fs.text(file), "");
  assert(file !== await fs.tempFile({ prefix: "t-", dir }));

  const sub = await fs.tempDir({ prefix: "d-", dir });
  assert(sub.startsWith(dir + "/d-"));
  assertEquals((await fs.list(sub)).length, 0);
}));

test("fs: a request in dev looks fresh, others use the cache", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.isFile(path), false);
  await writeFile(path, "foreign");
  // deno-lint-ignore no-explicit-any
  const run = (dev: boolean) => requestStorage.run({ dev } as any, () => fs.isFile(path));
  assertEquals(await run(false), false);
  assertEquals(await run(true), true);
}));

test("fs: mode applies to new files and directories", () => inDir(async (dir) => {
  await fs.mkdir(dir + "/private", { mode: 0o700 });
  await fs.write(dir + "/private/key", "secret", { mode: 0o600 });
  assertEquals((await stat(dir + "/private")).mode! & 0o777, 0o700);
  assertEquals((await stat(dir + "/private/key")).mode! & 0o777, 0o600);
}));
