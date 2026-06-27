import { assertEquals } from "../../core/tests/deps.ts";
import { HtmlBuilder } from "../../core/lib/HtmlBuilder.ts";
import { Csp } from "../../core/lib/Csp.ts";
import { rewriteHtml } from "../plugin.ts";

Deno.test("uncdn: rewriteHtml proxies CSP-declared origins and drops them", () => {
  const html = new HtmlBuilder();
  const remote = "https://cdn.example/lib/";
  html.importMap.set("lib/", remote);
  html.scripts.add(remote + "main.js");
  html.styles.add(remote + "main.css");

  const csp = new Csp();
  csp["script-src"][remote] = true;
  csp["style-src"][remote] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals(html.importMap.get("lib/"), "/app/uncdn/cdn.example/lib/");
  assertEquals([...html.scripts], ["/app/uncdn/cdn.example/lib/main.js"]);
  assertEquals([...html.styles], ["/app/uncdn/cdn.example/lib/main.css"]);
  assertEquals(csp["script-src"][remote], undefined); // now served same-origin
  assertEquals(csp["style-src"][remote], undefined);
});

Deno.test("uncdn: undeclared and query-string URLs stay external", () => {
  const html = new HtmlBuilder();
  html.scripts.add("https://other.example/x.js");        // not in CSP → left as-is
  const fonts = "https://fonts.googleapis.com/css?family=Inter";
  html.styles.add(fonts);                                 // declared but has query → not proxyable

  const csp = new Csp();
  csp["style-src"]["https://fonts.googleapis.com/"] = true;
  rewriteHtml(html, "/app/", csp);

  assertEquals([...html.scripts], ["https://other.example/x.js"]);
  assertEquals([...html.styles], [fonts]);
  assertEquals(csp["style-src"]["https://fonts.googleapis.com/"], true); // kept, still referenced
});
