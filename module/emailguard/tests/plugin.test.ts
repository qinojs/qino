import { assertEquals, assertStringIncludes } from "@std/assert";
import { ResHtml, unb64url } from "@qino/qino";

import { protect } from "../plugin.ts";

/** What the client script does, so a test proves the round trip rather than the encoding. */
function decode(token: string, key: string): string {
  const bytes = unb64url(token).map((b, i) => b ^ key.charCodeAt(i % key.length));
  return new TextDecoder().decode(bytes);
}

const guarded = (content: string) => {
  const html = new ResHtml();
  html.content = content;
  protect(html, "/m/");
  return html;
};

Deno.test("emailguard: a text address keeps its visible form and loses its readable one", () => {
  const html = guarded("<p>Write to info@example.com today</p>");
  const cls = [...html.inlineStyles][0].match(/^\.(\w+)\{display:none\}$/)?.[1];
  assertEquals(typeof cls, "string");
  assertStringIncludes(html.content, `info<span class=${cls}>`);
  // whatever strips the tags is left with an address that does not exist
  assertEquals(/info@example\.com/.test(html.content.replace(/<[^>]+>/g, "")), false);
  assertEquals(html.scripts.size, 0); // text needs no script
});

Deno.test("emailguard: a mailto href is encoded and restores to itself", () => {
  const html = guarded('<a href="mailto:info@example.com?subject=Hi">mail</a>');
  const key = (html.jsData.emailguard as { key: string }).key;
  const token = html.content.match(/mailto:([\w-]+)\?/)![1];
  assertEquals(decode(token, key), "info@example.com");
  assertStringIncludes(html.content, "?subject=Hi"); // the query survives untouched
  assertEquals([...html.scripts], ["/m/emailguard/pub/main.js"]);
});

Deno.test("emailguard: leaves code, comments and other attributes alone", () => {
  const source = '<script>const a = "x@y.com";</script><!-- b@y.com --><img alt="c@y.com"><style>@media all{}</style>';
  const html = guarded(source);
  assertEquals(html.content, source);
  assertEquals(html.scripts.size, 0);
  assertEquals(html.inlineStyles.size, 0);
});

Deno.test("emailguard: a body without an address is untouched", () => {
  const html = guarded("<p>@media is not an address</p>");
  assertEquals(html.content, "<p>@media is not an address</p>");
});

Deno.test("emailguard: an uppercase code block and a quoted attribute stay untouched", () => {
  const source = '<SCRIPT>var m = "x@y.com";</SCRIPT><img alt="see 1 > 0, write to c@y.com">';
  assertEquals(guarded(source).content, source);
});

Deno.test("emailguard: several addresses in one body are all rewritten", () => {
  const html = guarded("<p>a@x.com</p><p>b@x.com</p>");
  assertEquals(html.content.match(/<span/g)?.length, 2);
});
