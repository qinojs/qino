import https from "node:https";
import { Readable, Writable } from "node:stream";

import { Output, ResCsp, ResHtml } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { uncdnInstances } from "../internal.ts";
import { init, rewriteHtml } from "../plugin.ts";

async function routeFor(url: string, source: string, cache = "/tmp/uncdn-origin-test/cache/uncdn/") {
  let route: (event: { ctx: any }) => Promise<void> = () => Promise.resolve();
  const ctx = await testContext({ url, app: {
    modules: { get: () => ({ cache }) },
    on: (name: string, handler: typeof route) => { if (name === "route") route = handler; },
  } });
  init(ctx.app, { signal: new AbortController().signal });
  uncdnInstances.get(ctx.app)!.origins.add(source);
  return { ctx, route };
}

Deno.test("uncdn: rewriteHtml proxies CSP-declared origins and drops them", () => {
  const html = new ResHtml();
  const remote = "https://cdn.example/lib/";
  html.importMap.set("lib/", remote);
  html.scripts.add(remote + "main.js");
  html.styles.add(remote + "main.css");

  const csp = new ResCsp();
  csp["script-src"][remote] = true;
  csp["style-src"][remote] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals(html.importMap.get("lib/"), "/app/uncdn/cdn.example/lib/");
  assertEquals([...html.scripts], ["/app/uncdn/cdn.example/lib/main.js"]);
  assertEquals([...html.styles], ["/app/uncdn/cdn.example/lib/main.css"]);
  assertEquals(csp["script-src"][remote], undefined); // now served same-origin
  assertEquals(csp["style-src"][remote], undefined);
});

Deno.test("uncdn: a url mapped to itself is the handle for an import nothing can rewrite", () => {
  // qino.js imports item.js by its url; core maps that url to itself so this pass can take it over
  const html = new ResHtml();
  const remote = "https://cdn.example/item/";
  html.importMap.set(remote, remote);

  const csp = new ResCsp();
  csp["script-src"][remote] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals(html.importMap.get(remote), "/app/uncdn/cdn.example/item/");
  assertEquals(csp["script-src"][remote], undefined); // the browser resolves it same-origin now
});

Deno.test("uncdn: a sheet in html.link is proxied, keeping its attributes", () => {
  const html = new ResHtml();
  const remote = "https://cdn.example/lib/";
  html.link[remote + "print.css"] = { rel: "stylesheet", media: "print" };
  html.link[remote] = { rel: "preconnect" }; // not a sheet — stays external

  const csp = new ResCsp();
  csp["style-src"][remote] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals(html.link["/app/uncdn/cdn.example/lib/print.css"], { rel: "stylesheet", media: "print" });
  assertEquals(html.link[remote], { rel: "preconnect" });
  assertEquals(csp["style-src"][remote], true); // the preconnect still points there
});

Deno.test("uncdn: a source no html asset names survives — an import inside a script may need it", () => {
  const html = new ResHtml();
  const csp = new ResCsp();
  csp["script-src"]["https://cdn.example/npm/lib/+esm"] = true; // imported from within a local module
  rewriteHtml(html, "/app/", csp);

  assertEquals(csp["script-src"]["https://cdn.example/npm/lib/+esm"], true);
});

Deno.test("uncdn: undeclared and query-string URLs stay external", () => {
  const html = new ResHtml();
  html.scripts.add("https://other.example/x.js");        // not in CSP → left as-is
  const fonts = "https://fonts.googleapis.com/css?family=Inter";
  html.styles.add(fonts);                                 // declared but has query → not proxyable

  const csp = new ResCsp();
  csp["style-src"]["https://fonts.googleapis.com/"] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals([...html.scripts], ["https://other.example/x.js"]);
  assertEquals([...html.styles], [fonts]);
  assertEquals(csp["style-src"]["https://fonts.googleapis.com/"], true); // kept, still referenced
});

// The proxy path carries no scheme and is fetched back as https, so an http source
// rewritten into it could never be served — a local dev root stays where it is.
Deno.test("uncdn: an http source stays external", () => {
  const html = new ResHtml();
  html.scripts.add("http://localhost/u2/js/rte/rte.js");
  html.styles.add("http://localhost/u2/css/base/base.css");
  html.importMap.set("@qino/u2/", "http://localhost/u2/");

  const csp = new ResCsp();
  csp["script-src"]["http://localhost/u2/"] = true;
  csp["style-src"]["http://localhost/u2/"] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals([...html.scripts], ["http://localhost/u2/js/rte/rte.js"]);
  assertEquals([...html.styles], ["http://localhost/u2/css/base/base.css"]);
  assertEquals(html.importMap.get("@qino/u2/"), "http://localhost/u2/");
  assertEquals(csp["script-src"]["http://localhost/u2/"], true);
});

Deno.test("uncdn: lookalike origin is not covered by a declared source", async () => {
  const { ctx, route } = await routeFor(
    "https://qino.test/uncdn/cdn.example.attacker.test/a.js",
    "https://cdn.example",
  );

  await assertRejects(() => route({ ctx }), Output);
  assertEquals(ctx.res.status, 404);
  assertEquals(ctx.res.body, "Not cached");
});

Deno.test("uncdn: declared source is fetched", async () => {
  const { ctx, route } = await routeFor(
    "https://qino.test/uncdn/127.0.0.1/a.js",
    "https://127.0.0.1",
  );

  await assertRejects(() => route({ ctx }), Error, "SSRF blocked: 127.0.0.1");
  assertEquals(ctx.res.status, 200);
});

async function cacheTest(run: (fixture: {
  file: string;
  request: () => Promise<Response>;
  downloads: () => number;
}) => Promise<void>) {
  const cache = await Deno.makeTempDir({ prefix: "uncdn-" }) + "/";
  const original = https.request;
  let downloads = 0;
  try {
    https.request = ((_url: unknown, _options: unknown, done: (res: unknown) => void) => new Writable({
      final(callback) {
        downloads++;
        done(Object.assign(Readable.from([new TextEncoder().encode("complete asset")]), {
          statusCode: 200, statusMessage: "OK", headers: {},
        }));
        callback();
      },
    })) as unknown as typeof https.request;
    const url = "https://qino.test/uncdn/93.184.216.34/a.js";
    const { route } = await routeFor(url, "https://93.184.216.34/", cache);
    await run({
      file: cache + "93.184.216.34/a.js",
      request: async () => {
        const ctx = await testContext({ url });
        try { await route({ ctx }); }
        catch (error) {
          if (error instanceof Output) return error.toResponse();
          throw error;
        }
        throw new Error("route did not respond");
      },
      downloads: () => downloads,
    });
  } finally {
    https.request = original;
    await Deno.remove(cache, { recursive: true });
  }
}

Deno.test("uncdn: concurrent misses share a download and only publish complete files", async () => {
  await cacheTest(async ({ file, request, downloads }) => {
    const writeFile = Deno.writeFile;
    const readFile = Deno.readFile;
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const secondRead = Promise.withResolvers<void>();
    let observeRead = false;
    const requests: Promise<Response>[] = [];
    try {
      Deno.writeFile = async (path, data, options) => {
        await writeFile(path, new TextEncoder().encode("partial"), options);
        writing.resolve();
        await release.promise;
        await writeFile(path, data, options);
      };
      Deno.readFile = async (path, options) => {
        try { return await readFile(path, options); }
        finally { if (observeRead && path === file) secondRead.resolve(); }
      };
      requests.push(request());
      await writing.promise;
      await assertRejects(() => Deno.stat(file), Deno.errors.NotFound);
      observeRead = true;
      requests.push(request());
      await secondRead.promise;
      release.resolve();
      const responses = await Promise.all(requests);
      assertEquals(downloads(), 1);
      for (const response of responses) assertEquals(await response.text(), "complete asset");
      assertEquals(await Deno.readTextFile(file), "complete asset");
      assertEquals((await Array.fromAsync(Deno.readDir(file.slice(0, file.lastIndexOf("/"))))).map(e => e.name), ["a.js"]);
      assertEquals(await (await request()).text(), "complete asset");
      assertEquals(downloads(), 1);
    } finally {
      release.resolve();
      await Promise.allSettled(requests);
      Deno.writeFile = writeFile;
      Deno.readFile = readFile;
    }
  });
});

for (const operation of ["writeFile", "rename"] as const) {
  Deno.test(`uncdn: failed ${operation} cleans partial files and allows retry`, async () => {
    await cacheTest(async ({ file, request, downloads }) => {
      const original = Deno[operation];
      try {
        const writeFile = Deno.writeFile;
        Object.assign(Deno, { [operation]: async (path: string | URL) => {
          if (operation === "writeFile") await writeFile(path, new Uint8Array([1]));
          throw new Error("disk failure");
        } });
        await assertRejects(request, Error, "disk failure");
      } finally {
        Object.assign(Deno, { [operation]: original });
      }
      await assertRejects(() => Deno.stat(file), Deno.errors.NotFound);
      assertEquals(await Array.fromAsync(Deno.readDir(file.slice(0, file.lastIndexOf("/")))), []);
      assertEquals(await (await request()).text(), "complete asset");
      assertEquals(downloads(), 2);
    });
  });
}
