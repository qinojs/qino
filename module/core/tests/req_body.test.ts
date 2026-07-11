import { assert, assertEquals, assertThrows, testContext } from "./deps.ts";
import { ReqBody } from "../lib/ctx/ReqBody.ts";
import { Req } from "../lib/ctx/Req.ts";
import { Output } from "../lib/util.ts";

const parse = (init?: RequestInit, maxSize = 1024 * 1024) =>
  ReqBody.parse(new Request("http://qino.test/", init), { maxSize });

Deno.test("ReqBody: no body -> post === null", async () => {
  assertEquals((await parse()).value, null);
  assertEquals((await parse({ method: "POST" })).value, null);
});

Deno.test("ReqBody: unknown content-type -> post === null", async () => {
  const b = await parse({ method: "POST", body: "hello", headers: { "content-type": "text/plain" } });
  assertEquals(b.value, null);
});

Deno.test("ReqBody: json string body -> post === 'string'", async () => {
  const b = await parse({ method: "POST", body: '"hello"', headers: { "content-type": "application/json" } });
  assertEquals(b.value, "hello");
});

Deno.test("ReqBody: form -> flat frozen record", async () => {
  const b = await parse({ method: "POST", body: new URLSearchParams({ xyz: "1" }) });
  assertEquals(b.value.xyz, "1");
  assert(Object.isFrozen(b.value));
  assertThrows(() => { b.value.xyz = "2"; }, TypeError);
});

Deno.test("ReqBody: json deep, also on PUT, deep-frozen", async () => {
  const b = await parse({ method: "PUT", body: JSON.stringify({ xyz: { abc: 42 } }), headers: { "content-type": "application/json" } });
  assertEquals(b.value.xyz.abc, 42);
  assert(Object.isFrozen(b.value.xyz));
});

Deno.test("ReqBody: invalid json -> 400 Output", async () => {
  const err = await parse({ method: "POST", body: "{oops", headers: { "content-type": "application/json" } }).catch((e) => e);
  assert(err instanceof Output);
  assertEquals(err.status, 400);
});

Deno.test("ReqBody: content-length over maxSize -> 413 Output", async () => {
  const err = await parse({ method: "POST", body: '"' + "x".repeat(2046) + '"', headers: { "content-type": "application/json", "content-length": "2048" } }, 1024).catch((e) => e);
  assert(err instanceof Output);
  assertEquals(err.status, 413);
});

Deno.test("ReqBody: files proxy — sync `in`/keys, lazy per-file spool, missing key -> undefined", async () => {
  const fd = new FormData();
  fd.append("xyz", "1");
  fd.append("up", new File(["data"], "a.txt", { type: "text/plain" }));
  const b = await parse({ method: "POST", body: fd });

  assertEquals(b.value.xyz, "1");
  assert(!("up" in b.value));            // files never leak into post
  assert("up" in b.files);              // sync, no disk work yet
  assertEquals(Object.keys(b.files), ["up"]);
  assertEquals(b.files.nope, undefined);
  assertEquals(b.tmpPaths.length, 0);   // nothing spooled yet

  const f = await b.files.up;
  assertEquals(f!.name, "a.txt");
  assertEquals(f!.size, 4);
  assertEquals(await Deno.readTextFile(f!.tmpPath), "data");
  assert(b.files.up === b.files.up);    // memoized per key

  for (const p of await b.settle()) await Deno.remove(p).catch(() => {});
});

Deno.test("ReqBody: `await body.files` without key is harmless (no `then` trap)", async () => {
  const b = await parse({ method: "POST", body: new URLSearchParams({ a: "1" }) });
  assertEquals(await b.files, b.files);
});

Deno.test("ReqBody: __proto__/then/toString are plain data keys (form)", async () => {
  const b = await parse({ method: "POST", body: new URLSearchParams([["__proto__", "x"], ["then", "y"], ["toString", "z"]]) });
  assertEquals(b.value.__proto__, "x");
  assertEquals(b.value.then, "y");
  assertEquals(b.value.toString, "z");
  assertEquals(({} as Record<string, unknown>).x, undefined); // no prototype pollution
});

Deno.test("ReqBody: __proto__/then/toString are plain data keys (json)", async () => {
  const b = await parse({ method: "POST", body: '{"__proto__":"x","then":"y","toString":"z"}', headers: { "content-type": "application/json" } });
  assertEquals(b.value.__proto__, "x");
  assertEquals(b.value.then, "y");
  assertEquals(b.value.toString, "z");
  assertEquals(Object.getPrototypeOf({}), Object.prototype); // no prototype pollution
});

Deno.test("ReqBody: upload field named `then` stays a normal file", async () => {
  const fd = new FormData();
  fd.append("then", new File(["x"], "t.txt"));
  const b = await parse({ method: "POST", body: fd });
  const f = await b.files.then;
  assertEquals(f!.name, "t.txt");
  assertEquals(await b.files, b.files); // proxy itself still not thenable (then not callable)
  for (const p of await b.settle()) await Deno.remove(p).catch(() => {});
});

Deno.test("ReqBody: repeated form keys become arrays, singles stay scalar", async () => {
  const b = await parse({ method: "POST", body: new URLSearchParams([["to_users", "1"], ["to_users", "2"], ["subject", "s"]]) });
  assertEquals(b.value.to_users, ["1", "2"]);
  assertEquals(b.value.subject, "s");
  assert(Object.isFrozen(b.value.to_users));
});

Deno.test("ReqBody: chunked json (no content-length) parses through the capped reader", async () => {
  const req = new Request("http://qino.test/", {
    method: "POST",
    body: new Blob(['{"a":1}']).stream(),
    headers: { "content-type": "application/json" },
    // @ts-ignore duplex is required for stream bodies
    duplex: "half",
  });
  assertEquals(req.headers.get("content-length"), null); // stream body really has no length
  const b = await ReqBody.parse(req, { maxSize: 1024 });
  assertEquals(b.value.a, 1);
});

Deno.test("ReqBody: chunked body over maxSize -> 413 while reading", async () => {
  const req = new Request("http://qino.test/", {
    method: "POST",
    body: new Blob(['{"a":"' + "x".repeat(2048) + '"}']).stream(),
    headers: { "content-type": "application/json" },
    // @ts-ignore duplex is required for stream bodies
    duplex: "half",
  });
  const err = await ReqBody.parse(req, { maxSize: 1024 }).catch((e) => e);
  assert(err instanceof Output);
  assertEquals(err.status, 413);
  await req.body?.cancel(); // in production the server runtime drains unread request bodies
});

Deno.test("ReqBody: streaming/raw content-types stay untouched (no 411, req still readable)", async () => {
  const stream = new Blob(["audio-bytes"]).stream();
  const req = new Request("http://qino.test/", {
    method: "POST",
    body: stream,
    headers: { "content-type": "audio/webm" },
    // @ts-ignore duplex is required for stream bodies
    duplex: "half",
  });
  const b = await ReqBody.parse(req, { maxSize: 1024 });
  assertEquals(b.value, null);
  assertEquals(await req.text(), "audio-bytes"); // raw stream untouched by ReqBody
});

Deno.test("Req.query: always flat, first value wins", async () => {
  const req = await Req.create(new Request("http://qino.test/?xyz=a&xyz=b"));
  assertEquals(req.query.xyz, "a");
});

Deno.test("Ctx defaults: post null, files empty", async () => {
  const ctx = await testContext();
  assertEquals(ctx.req.body, null);
  assertEquals(Object.keys(ctx.req.files), []);
});
