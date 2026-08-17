import { Output, ResCsp, ResHtml } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { uncdnInstances } from "../internal.ts";
import { init, rewriteHtml } from "../plugin.ts";

async function routeFor(url: string, source: string) {
  let route: (event: { ctx: any }) => Promise<void> = () => Promise.resolve();
  const ctx = await testContext({ url, app: {
    modules: { get: () => ({ cache: "/tmp/uncdn-origin-test/cache/uncdn/" }) },
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
