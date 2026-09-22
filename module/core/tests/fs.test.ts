import { assert, assertEquals, assertRejects } from "./deps.ts";
import { fs } from "../lib/fs.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

/** A fresh dir per test — the cache is module-wide, paths must not repeat. */
async function inDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.tempDir({ prefix: "qino-fs-" });
  try { await fn(dir); } finally { await fs.remove(dir, { recursive: true }); }
}

Deno.test("fs: stat, isFile, size, mtime; missing is undefined", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.stat(path), undefined);
  assertEquals(await fs.isFile(path), false);
  assertEquals(await fs.mtime(path), undefined);

  await fs.write(path, "hello");
  const info = await fs.stat(path);
  assertEquals(info?.isFile, true);
  assertEquals(info?.size, 5);
  assert(info?.mtime instanceof Date);
  assert(info?.atime instanceof Date);
  assertEquals(await fs.size(path), 5);
  assertEquals(await fs.mtime(path), info?.mtime?.getTime());
  assertEquals(await fs.isFile(dir), false); // a directory is not a file
}));

Deno.test("fs: foreign writes stay unseen until ttl, own writes are seen at once", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.isFile(path), false);
  await Deno.writeTextFile(path, "foreign");
  assertEquals(await fs.isFile(path), false); // cached miss
  assertEquals(await fs.isFile(path, { ttl: 0 }), true);

  await Deno.remove(path);
  assertEquals(await fs.isFile(path), true); // cached hit
  await fs.write(path, "own");
  assertEquals(await fs.size(path), 3);
}));

Deno.test("fs: concurrent stats share one lookup", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "x");
  const a = fs.stat(path), b = fs.stat(path);
  assertEquals(a, b);
}));

Deno.test("fs: text, bytes, write with createNew", () => inDir(async (dir) => {
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

Deno.test("fs: write takes a stream", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, new Blob(["hello ", "world"]).stream());
  assertEquals(await fs.text(path), "hello world");
  await fs.write(path, new Blob(["x"]).stream()); // truncates
  assertEquals(await fs.text(path), "x");
}));

Deno.test("fs: stream, whole and as a range", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "hello world");
  assertEquals(await new Response(await fs.stream(path)).text(), "hello world");
  assertEquals(await new Response(await fs.stream(path, { start: 6, end: 10 })).text(), "world"); // end inclusive
  assertEquals(await new Response(await fs.stream(path, { start: 6 })).text(), "world");
}));

Deno.test("fs: stream of a missing file throws at once", () => inDir(async (dir) => {
  const err = await assertRejects(() => fs.stream(dir + "/nope.txt"));
  assertEquals((err as { code?: string }).code, "ENOENT");
  await assertRejects(() => fs.stream(dir + "/nope.txt", { start: 1 }));
}));

Deno.test("fs: list, mkdir", () => inDir(async (dir) => {
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

Deno.test("fs: remove forgets the path and everything below", () => inDir(async (dir) => {
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

Deno.test("fs: rename, copy", () => inDir(async (dir) => {
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

Deno.test("fs: symlink, touch", () => inDir(async (dir) => {
  const a = dir + "/a.txt", link = dir + "/link.txt";
  await fs.write(a, "x");
  assertEquals(await fs.isFile(link), false);
  await fs.symlink(a, link);
  assertEquals(await fs.isFile(link), true); // stat follows the link
  assertEquals(await fs.text(link), "x");

  const old = new Date(2000, 0, 1);
  await Deno.utime(a, old, old);
  assertEquals(await fs.mtime(a, { ttl: 0 }), old.getTime());
  await fs.touch(a);
  assert(await fs.mtime(a) as number > old.getTime());
}));

Deno.test("fs: writable", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "x");
  assertEquals(await fs.writable(path), true);
  assertEquals(await fs.writable(dir + "/nope.txt"), false);
}));

Deno.test("fs: tempFile, tempDir", () => inDir(async (dir) => {
  const file = await fs.tempFile({ prefix: "t-", dir });
  assert(file.startsWith(dir + "/t-"));
  assertEquals(await fs.text(file), "");
  assert(file !== await fs.tempFile({ prefix: "t-", dir }));

  const sub = await fs.tempDir({ prefix: "d-", dir });
  assert(sub.startsWith(dir + "/d-"));
  assertEquals((await fs.list(sub)).length, 0);
}));

Deno.test("fs: a request in dev looks fresh, others use the cache", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  assertEquals(await fs.isFile(path), false);
  await Deno.writeTextFile(path, "foreign");
  // deno-lint-ignore no-explicit-any
  const run = (dev: boolean) => requestStorage.run({ dev } as any, () => fs.isFile(path));
  assertEquals(await run(false), false);
  assertEquals(await run(true), true);
}));
