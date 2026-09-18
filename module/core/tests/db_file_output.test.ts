import { assertEquals, DbFileManager } from "./deps.ts";

/** One public file stored under `mime`; resolves with the response headers for it. */
async function headersFor(mime: string, name = "a.bin") {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(dir + "/aaa", "<x/>");
    const row = { id: 3, name, md5: "aaa", mime, access: "1" };
    const app = {
      db: { row: () => Promise.resolve({ ...row }) },
      fileTransformer: { transform: (path: string) => ({ path, mime: "" }) },
    };
    const res = await new DbFileManager(app as never, dir).output(`3/${name}`, new Request("http://x/"));
    await res.body?.cancel();
    return res.headers;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("dbFile: anything a browser renders as a document is sandboxed", async () => {
  for (const mime of ["application/xml", "text/xml", "image/svg+xml", "image/png", "text/plain", "application/x-unknown"]) {
    const h = await headersFor(mime);
    assertEquals([mime, h.get("Content-Security-Policy"), h.get("X-Content-Type-Options")], [mime, "sandbox", "nosniff"]);
  }
});

Deno.test("dbFile: html never goes out as html, whatever its case", async () => {
  for (const mime of ["text/html", "TEXT/HTML", "Text/Html; charset=utf-8", "application/xhtml+xml"]) {
    assertEquals([mime, (await headersFor(mime)).get("Content-Type")], [mime, "text/plain"]);
  }
});

Deno.test("dbFile: pdf is left to the viewer, which refuses a sandbox", async () => {
  const h = await headersFor("application/pdf", "a.pdf");
  assertEquals([h.get("Content-Type"), h.get("Content-Security-Policy")], ["application/pdf", null]);
});
