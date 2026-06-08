import { assertEquals } from "../../core/tests/deps.ts";
import { HtmlBuilder } from "../../core/lib/HtmlBuilder.ts";
import { RequestContext } from "../../core/lib/RequestContext.ts";
import { rewriteHtml } from "../plugin.ts";

Deno.test("uncdn: rewriteHtml rewrites assets and import map targets", () => {
  const html = new HtmlBuilder(new RequestContext());
  const remote = "https://cdn.example/lib/";
  html.importMap.set("lib/", remote);
  html.scripts.add(remote + "main.js");
  html.styles.add(remote + "main.css");

  rewriteHtml(html, "/app/");

  assertEquals(html.importMap.get("lib/"), "/app/uncdn/cdn.example/lib/");
  assertEquals([...html.scripts], ["/app/uncdn/cdn.example/lib/main.js"]);
  assertEquals([...html.styles], ["/app/uncdn/cdn.example/lib/main.css"]);
});
