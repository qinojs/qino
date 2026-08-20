import { assertEquals } from "@std/assert";

import { htmlToText } from "../lib/htmlText.ts";

Deno.test("html becomes readable text: no comments, no scripts, no markup left over", () => {
  const html = `<!doctype html><html><head><title>hidden</title><style>p{color:red}</style></head>
<body>
<!--[if mso]><table><tr><td>Outlook only<![endif]-->
<!-- a plain comment -->
<h1>Order   shipped</h1>
<p>Hi <b>Ada</b>, see <a href="https://qino.test/p?a=1&amp;b=2">the parcel</a>.</p>
<div title="a > b">attribute with a bracket</div>
<script>alert("no")</script>
</body></html>`;
  assertEquals(htmlToText(html), [
    "Order shipped",
    "",
    "Hi Ada, see the parcel: https://qino.test/p?a=1&b=2.",
    "",
    "attribute with a bracket",
  ].join("\n"));
});

Deno.test("lists count and nest, tables keep their columns, pre keeps its shape", () => {
  const html = `<ul><li>one</li><li>two<ol><li>deep</li><li>deeper</li></ol></li></ul>
<table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>3.50</td></tr></table>
<pre>  kept   as is
  line two</pre>`;
  assertEquals(htmlToText(html), [
    "• one",
    "• two",
    "  1. deep",
    "  2. deeper",
    "",
    "Item\tPrice",
    "Tea\t3.50",
    "",
    "  kept   as is",
    "  line two",
  ].join("\n"));
});

Deno.test("an address survives, unless the text is the address", () => {
  assertEquals(htmlToText(`<a href="mailto:hi@qino.test">hi@qino.test</a>`), "hi@qino.test");
  assertEquals(htmlToText(`go <a href="#top">up</a> or <a href="https://qino.test">here</a>`), "go up or here: https://qino.test");
  assertEquals(htmlToText(`<a href="https://qino.test"><img src=x alt="Logo"></a>`), "Logo: https://qino.test");
});

Deno.test("entities are decoded and blank lines never pile up", () => {
  assertEquals(htmlToText("<p>&euro;5 &amp; more&nbsp;— done</p>"), "€5 & more — done");
  assertEquals(htmlToText("<div><div><div>deep</div></div></div><hr><p>after</p>"), "deep\n\n---\n\nafter");
  assertEquals(htmlToText("a<br>b<br><br><br>c"), "a\nb\n\nc");
});

Deno.test("what the reader never sees is not read out — the preheader spacer least of all", () => {
  const html = `<div style="display:none;max-height:0">Your order shipped&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;</div>
<div hidden>never</div><span aria-hidden="true">decoration</span><span style="visibility: hidden">gone</span>
<p>Hi <span style="display:none">not here</span>Ada</p>`;
  assertEquals(htmlToText(html), "Hi Ada");
});

Deno.test("a link keeps its address without a colon dangling on its own line", () => {
  assertEquals(htmlToText(`<a href="https://qino.test"><div>Order now</div></a>`), "Order now\nhttps://qino.test");
  assertEquals(htmlToText(`text <a href="  ">nothing behind it</a>`), "text nothing behind it");
});

Deno.test("text following a link does not stick to its address, punctuation still does", () => {
  assertEquals(htmlToText(`<a href="https://qino.test">Shop</a>opens daily`), "Shop: https://qino.test opens daily");
  assertEquals(htmlToText(`see <a href="https://qino.test">here</a>.`), "see here: https://qino.test.");
});
