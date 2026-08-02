import type { IncomingMessage, RequestOptions } from "node:http";
import https from "node:https";
import { Readable, Writable } from "node:stream";
import { assertEquals, assertRejects } from "./deps.ts";
import { readDataUrl, readUploadFile, safeFetch } from "../lib/fileStream.ts";

Deno.test("fileStream: readUploadFile stores upload metadata and md5", async () => {
  const file = new File([new Uint8Array([1, 2, 3]), "abc"], "upload.txt", { type: "text/plain" });
  const uploaded = await readUploadFile(file, { maxSize: 10 });
  try {
    assertEquals(uploaded.name, "upload.txt");
    assertEquals(uploaded.type, "text/plain");
    assertEquals(uploaded.size, 6);
    assertEquals(uploaded.md5, "9dd9947b1036216969f6d340cae9aa4e");
    assertEquals(await Deno.readFile(uploaded.tmpPath), new Uint8Array([1, 2, 3, 97, 98, 99]));
  } finally {
    await Deno.remove(uploaded.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: readUploadFile rejects streams over maxSize", async () => {
  const file = new File(["too large"], "large.txt", { type: "text/plain" });
  await assertRejects(() => readUploadFile(file, { maxSize: 3 }), Error, "Stream too large");
});

Deno.test("fileStream: readUploadFile accepts empty and exact maxSize files", async () => {
  const empty = await readUploadFile(new File([""], "empty.txt", { type: "text/plain" }), { maxSize: 1 });
  const exact = await readUploadFile(new File(["123"], "exact.txt", { type: "text/plain" }), { maxSize: 3 });
  try {
    assertEquals(empty.size, 0);
    assertEquals(empty.md5, "d41d8cd98f00b204e9800998ecf8427e");
    assertEquals(exact.size, 3);
    assertEquals(exact.md5, "202cb962ac59075b964b07152d234b70");
  } finally {
    await Deno.remove(empty.tmpPath).catch(() => {});
    await Deno.remove(exact.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: readDataUrl decodes base64 and names by mime", async () => {
  const f = await readDataUrl("data:image/png;base64,YWJj", { maxSize: 10 });
  try {
    assertEquals(f.name, "file.png");
    assertEquals(f.type, "image/png");
    assertEquals(f.size, 3);
    assertEquals(f.md5, "900150983cd24fb0d6963f7d28e17f72");
    assertEquals(await Deno.readTextFile(f.tmpPath), "abc");
  } finally {
    await Deno.remove(f.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: readDataUrl takes an explicit name and percent-encoded payloads", async () => {
  const named = await readDataUrl("data:image/png;name=cat.png;base64,YWJj", { maxSize: 10 });
  const plain = await readDataUrl("data:text/plain,a%20b", { maxSize: 10 });
  try {
    assertEquals(named.name, "cat.png");
    assertEquals(plain.name, "file.txt");
    assertEquals(await Deno.readTextFile(plain.tmpPath), "a b");
  } finally {
    await Deno.remove(named.tmpPath).catch(() => {});
    await Deno.remove(plain.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: readDataUrl rejects malformed URIs and oversized payloads", async () => {
  await assertRejects(() => readDataUrl("data:image/png;base64", { maxSize: 10 }), Error, "Invalid data URI");
  await assertRejects(() => readDataUrl("data:image/png;base64,!!!", { maxSize: 10 }), Error, "Invalid data URI payload");
  await assertRejects(() => readDataUrl("data:text/plain,too large", { maxSize: 3 }), Error, "Stream too large");
});

Deno.test("fileStream: readDataUrl strips path traversal from the name", async () => {
  const f = await readDataUrl("data:image/png;name=../../etc/passwd;base64,YWJj", { maxSize: 10 });
  try {
    assertEquals(f.name, "passwd");
  } finally {
    await Deno.remove(f.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: safeFetch pins public DNS and blocks non-public IPs", async () => {
  const resolveDns = Deno.resolveDns;
  const request = https.request;
  const pinned: string[] = [];
  let requested = 0;
  try {
    Deno.resolveDns = ((host: string, type: Deno.RecordType) => {
      const ip = host === "mixed.example" && type === "AAAA" ? "fe90::1" : host === "private.example" ? "10.0.0.1" : "93.184.216.34";
      return Promise.resolve(type === (ip.includes(":") ? "AAAA" : "A") ? [ip] : []);
    }) as typeof Deno.resolveDns;
    https.request = ((url: string | URL, opt: RequestOptions, done?: (res: IncomingMessage) => void) => {
      requested++;
      opt.lookup!("ignored", { all: true }, ((_error: Error | null, addresses: { address: string }[]) => pinned.push(addresses[0].address)) as never);
      const redirect = new URL(String(url)).hostname === "redirect.example";
      const req = new Writable({
        final(callback) {
          done!(Object.assign(Readable.from(redirect ? [] : [new TextEncoder().encode("ok")]), {
            statusCode: redirect ? 302 : 200,
            statusMessage: redirect ? "Found" : "OK",
            headers: redirect ? { location: "http://private.example/" } : {},
          }) as never);
          callback();
        },
      });
      return req as never;
    }) as unknown as typeof https.request;

    assertEquals(await (await safeFetch("https://files.example/a")).text(), "ok");
    assertEquals(pinned, ["93.184.216.34"]);
    await assertRejects(() => safeFetch("https://mixed.example/"), Error, "SSRF blocked: fe90::1");
    await assertRejects(() => safeFetch("https://redirect.example/"), Error, "SSRF blocked: 10.0.0.1");

    for (const ip of ["0.0.0.1", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "240.0.0.1"])
      await assertRejects(() => safeFetch(`http://${ip}/`), Error, "SSRF blocked");
    for (const ip of ["::1", "::ffff:7f00:1", "100::1", "2001:db8::1", "3fff::1", "fc00::1", "fe90::1", "ff00::1"])
      await assertRejects(() => safeFetch(`http://[${ip}]/`), Error, "SSRF blocked");
    assertEquals(requested, 2);
    assertEquals(pinned, ["93.184.216.34", "93.184.216.34"]);
  } finally {
    Deno.resolveDns = resolveDns;
    https.request = request;
  }
});
