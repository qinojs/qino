import { assert, assertEquals } from "@qino/qino/tests";

import { htmlOf, sanitizeHtml, textOf, titleOf } from "../mod.ts";
import { htmlToText } from "../lib/htmlText.ts";

Deno.test("plain text goes out exactly as it was written", () => {
  const msg = { text: "50% * 2 <b>?" };
  assertEquals(textOf(msg), "50% * 2 <b>?");
  assertEquals(htmlOf(msg), undefined);
});

Deno.test("markdown renders to html and flattens to text", () => {
  const msg = {
    text: "# Order **shipped**\n\nHi *there*, see [the parcel](https://qino.test/p?a=1&b=2).\n\n- one\n- two\n\n> quoted\n\n```\ncode < here\n```",
    format: "md" as const,
  };
  assertEquals(
    htmlOf(msg),
    "<h1>Order <strong>shipped</strong></h1>\n" +
      '<p>Hi <em>there</em>, see <a href="https://qino.test/p?a=1&amp;b=2">the parcel</a>.</p>\n' +
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<blockquote>\n<p>quoted</p>\n</blockquote>\n" +
      "<pre><code>code &lt; here\n</code></pre>",
  );
  assertEquals(
    textOf(msg),
    "Order shipped\n\nHi there, see the parcel: https://qino.test/p?a=1&b=2.\n\n• one\n• two\n\nquoted\n\ncode < here",
  );
  assertEquals(titleOf(msg), "Order shipped");
});

Deno.test("markdown escapes what the markers did not ask for, in both directions", () => {
  const msg = { text: "<script>alert(1)</script> **safe**", format: "md" as const };
  // markdown's own rule: raw html opens a block, so what follows it stays literal — and escaped
  assertEquals(htmlOf(msg), "&lt;script&gt;alert(1)&lt;/script&gt; **safe**");
  assertEquals(htmlOf({ text: "[click](javascript:alert(1))", format: "md" as const }), "<p><a>click</a></p>"); // an address nobody may follow is dropped
});

Deno.test("telegram gets its own subset — no blocks, no lists, no headings", () => {
  const msg = { text: "# Title\n\n- one\n- two\n\nsee [here](https://qino.test)", format: "md" as const };
  assertEquals(htmlOf(msg, "telegram"), '<b>Title</b>\n\n• one\n• two\n\nsee <a href="https://qino.test">here</a>');
});

Deno.test("html degrades to readable text and is sanitized before it reaches a page", () => {
  const html = '<p>Hello <b>you</b></p><ul><li>one</li></ul><a href="https://qino.test">link</a>';
  assertEquals(htmlOf({ text: html, format: "html" }), html);
  assertEquals(textOf({ text: html, format: "html" }), "Hello you\n\n• one\n\nlink: https://qino.test");
  assertEquals(htmlToText("a &amp; b<br>c"), "a & b\nc");
  assert(!sanitizeHtml('<img src=x onerror="alert(1)"><script>alert(1)</script>ok').includes("onerror"));
});
