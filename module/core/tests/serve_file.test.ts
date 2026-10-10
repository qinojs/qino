import { assertEquals } from "./deps.ts";
import { fs } from "../lib/fs.ts";
import { serveFile } from "../lib/serveFile.ts";

/** A fresh dir per test — the stat cache is module-wide, paths must not repeat. */
async function inDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.tempDir({ prefix: "qino-serve-" });
  try { await fn(dir); } finally { await fs.remove(dir, { recursive: true }); }
}

const get = (path: string, headers: HeadersInit = {}, method = "GET") =>
  serveFile(new Request("http://x/", { method, headers }), path);

Deno.test("serveFile: whole file with type, length and validators", () => inDir(async (dir) => {
  await fs.write(dir + "/a.css", "body{}");
  const res = await get(dir + "/a.css");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "body{}");
  assertEquals(res.headers.get("content-type"), "text/css; charset=UTF-8");
  assertEquals(res.headers.get("content-length"), "6");
  assertEquals(res.headers.get("accept-ranges"), "bytes");
  assertEquals(typeof res.headers.get("etag"), "string");
  assertEquals(typeof res.headers.get("last-modified"), "string");
}));

Deno.test("serveFile: the length is of what is sent, also after a foreign write", () => inDir(async (dir) => {
  await fs.write(dir + "/a.js", "old");
  await get(dir + "/a.js").then((res) => res.text());
  await Deno.writeTextFile(dir + "/a.js", "longer"); // the cached stat still says 3
  const res = await get(dir + "/a.js");
  assertEquals(res.headers.get("content-length"), "6");
  assertEquals(await res.text(), "longer");
}));

Deno.test("serveFile: 404 for missing files and directories, 405 for other methods", () => inDir(async (dir) => {
  assertEquals((await get(dir + "/missing.txt")).status, 404);
  assertEquals((await get(dir)).status, 404);
  await fs.write(dir + "/a.txt", "x");
  const res = await get(dir + "/a.txt", {}, "POST");
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("allow"), "GET, HEAD");
}));

Deno.test("serveFile: HEAD has the length but no body", () => inDir(async (dir) => {
  await fs.write(dir + "/a.txt", "hello");
  const res = await get(dir + "/a.txt", {}, "HEAD");
  assertEquals(res.status, 200);
  assertEquals(res.body, null);
  assertEquals(res.headers.get("content-length"), "5");
}));

Deno.test("serveFile: 304 for a matching If-None-Match or If-Modified-Since", () => inDir(async (dir) => {
  await fs.write(dir + "/a.txt", "hello");
  const first = await get(dir + "/a.txt");
  await first.body?.cancel();
  const etag = first.headers.get("etag")!;
  assertEquals((await get(dir + "/a.txt", { "if-none-match": etag })).status, 304);
  assertEquals((await get(dir + "/a.txt", { "if-none-match": `"other", W/${etag}` })).status, 304);
  assertEquals((await get(dir + "/a.txt", { "if-modified-since": first.headers.get("last-modified")! })).status, 304);
  const stale = await get(dir + "/a.txt", { "if-none-match": '"other"' });
  assertEquals(stale.status, 200);
  await stale.body?.cancel();
}));

Deno.test("serveFile: single byte ranges", () => inDir(async (dir) => {
  const path = dir + "/a.txt";
  await fs.write(path, "0123456789");
  const range = (r: string, more: HeadersInit = {}) => get(path, { range: r, ...more });

  let res = await range("bytes=2-4");
  assertEquals(res.status, 206);
  assertEquals(await res.text(), "234");
  assertEquals(res.headers.get("content-range"), "bytes 2-4/10");
  assertEquals(res.headers.get("content-length"), "3");

  res = await range("bytes=7-");
  assertEquals(await res.text(), "789");
  res = await range("bytes=-3");
  assertEquals(await res.text(), "789");
  res = await range("bytes=8-99");
  assertEquals(res.headers.get("content-range"), "bytes 8-9/10");
  assertEquals(await res.text(), "89");

  res = await range("bytes=10-");
  assertEquals(res.status, 416);
  assertEquals(res.headers.get("content-range"), "bytes */10");

  res = await range("bytes=0-1,4-5"); // multi-range: the whole file
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "0123456789");

  res = await range("bytes=0-1", { "if-range": '"stale"' });
  assertEquals(res.status, 200);
  await res.body?.cancel();
}));

Deno.test("serveFile: given headers replace the defaults", () => inDir(async (dir) => {
  await fs.write(dir + "/a.bin", "hello");
  const headers = new Headers({ "ETag": '"mine"', "Content-Type": "text/plain" });
  const res = await serveFile(new Request("http://x/", { headers: { "if-none-match": '"mine"' } }), dir + "/a.bin", headers);
  assertEquals(res.status, 304);
  assertEquals(res.headers.get("content-type"), "text/plain");
}));
