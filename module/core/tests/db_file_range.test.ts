import { assertEquals, DbFileManager } from "./deps.ts";

/** A manager over one public row whose file holds `body`, plus a request helper. */
async function fixture(dir: string, body: string) {
  await Deno.writeTextFile(dir + "/aaa", body);
  const row = { id: 3, name: "a.txt", md5: "aaa", mime: "text/plain", access: "1" };
  const app = {
    db: { row: () => Promise.resolve({ ...row }) },
    fileTransformer: { transform: (path: string) => ({ path, mime: "text/plain" }) },
  };
  const files = new DbFileManager(app as never, dir);
  return (headers: Record<string, string> = {}) => files.output("3/a.txt", new Request("http://x/", { headers }));
}

Deno.test("dbFile: a satisfiable range is served as 206", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const request = await fixture(dir, "0123456789");
    const res = await request({ Range: "bytes=2-4" });
    assertEquals([res.status, res.headers.get("Content-Range"), res.headers.get("Content-Length")], [206, "bytes 2-4/10", "3"]);
    assertEquals(await res.text(), "234");

    const suffix = await request({ Range: "bytes=-3" });
    assertEquals([suffix.status, suffix.headers.get("Content-Range")], [206, "bytes 7-9/10"]);
    assertEquals(await suffix.text(), "789");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dbFile: an unsatisfiable range is 416, a malformed one is ignored", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const request = await fixture(dir, "0123456789");
    for (const range of ["bytes=20-30", "bytes=10-", "bytes=-0"]) {
      const res = await request({ Range: range });
      assertEquals([range, res.status, res.headers.get("Content-Range")], [range, 416, "bytes */10"]);
      assertEquals(await res.text(), "");
    }
    // Forms this server does not implement fall back to the whole file, as HTTP allows.
    for (const range of ["bytes=0-1,5-6", "items=0-1", "bytes=-"]) {
      const res = await request({ Range: range });
      assertEquals([range, res.status], [range, 200]);
      assertEquals(await res.text(), "0123456789");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dbFile: If-Range decides between 206 and the whole file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const request = await fixture(dir, "0123456789");
    const full = await request();
    const etag = full.headers.get("ETag")!;
    const lastModified = full.headers.get("Last-Modified")!;
    await full.body?.cancel();

    for (const ifRange of [etag, lastModified]) {
      const res = await request({ Range: "bytes=0-1", "If-Range": ifRange });
      assertEquals([ifRange, res.status], [ifRange, 206]);
      assertEquals(await res.text(), "01");
    }

    const stale = await request({ Range: "bytes=0-1", "If-Range": '"qgstale"' });
    assertEquals(stale.status, 200);
    assertEquals(await stale.text(), "0123456789");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dbFile: conditional requests accept lists, weak tags and If-Modified-Since", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const request = await fixture(dir, "0123456789");
    const full = await request();
    const etag = full.headers.get("ETag")!;
    const lastModified = full.headers.get("Last-Modified")!;
    await full.body?.cancel();

    for (const inm of [etag, `"qgother", ${etag}`, `W/${etag}`, "*"]) {
      const res = await request({ "If-None-Match": inm });
      assertEquals([inm, res.status, res.body], [inm, 304, null]);
    }

    const miss = await request({ "If-None-Match": '"qgother"' });
    assertEquals(miss.status, 200);
    await miss.body?.cancel();

    assertEquals((await request({ "If-Modified-Since": lastModified })).status, 304);
    const older = new Date(Date.parse(lastModified) - 1000).toUTCString();
    const changed = await request({ "If-Modified-Since": older });
    assertEquals(changed.status, 200);
    await changed.body?.cancel();

    // A present If-None-Match wins over If-Modified-Since.
    const both = await request({ "If-None-Match": '"qgother"', "If-Modified-Since": lastModified });
    assertEquals(both.status, 200);
    await both.body?.cancel();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
