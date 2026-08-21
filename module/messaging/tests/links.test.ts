import { assertEquals } from "@std/assert";

import { rewriteLinks } from "../lib/links.ts";
import { testApp as app } from "./deps.ts";

Deno.test("links are made absolute and traded for a short code, in every format", async () => {
  const a = await app();
  const md = await rewriteLinks(a, { text: "[shop](/shop) and ![pic](pic.png)", format: "md" });
  assertEquals(md.msg.text, "[shop](https://qino.test/s/c1) and ![pic](https://qino.test/s/c2)");
  assertEquals(md.links, [{ url: "https://qino.test/s/c1", kind: "click" }, { url: "https://qino.test/s/c2", kind: "load" }]);

  const html = await rewriteLinks(a, { text: `<a href="/shop">go</a><img src=pic.png>`, format: "html" });
  assertEquals(html.msg.text, `<a href="https://qino.test/s/c1">go</a><img src=https://qino.test/s/c2>`);

  const plain = await rewriteLinks(a, { text: "see https://example.test/a. thanks" });
  assertEquals(plain.msg.text, "see https://qino.test/s/c3. thanks"); // the full stop is the sentence's, not the address's
  await a.db.close();
});

Deno.test("an absolute address is a browser's, and what is not a web address is left alone", async () => {
  const a = await app(false);
  // no shortener: only what is relative is resolved, and against the host as a browser would
  const md = await rewriteLinks(a, { text: "[a](/root) [b](deep) [c](https://x.test) [d](mailto:a@b.ch) [e](#top)", format: "md" });
  assertEquals(md.msg.text, "[a](https://qino.test/root) [b](https://qino.test/cms2/deep) [c](https://x.test) [d](mailto:a@b.ch) [e](#top)");
  assertEquals(md.links, []); // nothing was shortened, so nothing can be tracked
  await a.db.close();
});

Deno.test("one of our own grants stays long; a foreign sig means nothing to us", async () => {
  const a = await app();
  const own = await rewriteLinks(a, { text: "[file](/cms2/dbFile/7/u-abcde/report.pdf?sig=verylongmac)", format: "md" });
  assertEquals(own.msg.text, "[file](https://qino.test/cms2/dbFile/7/u-abcde/report.pdf?sig=verylongmac)");
  assertEquals(own.links, []); // trading a signed grant for eight characters would be the weaker of the two

  const foreign = await rewriteLinks(a, { text: "[x](https://other.test/a?sig=whatever)", format: "md" });
  assertEquals(foreign.msg.text, "[x](https://qino.test/s/c1)"); // their sig is theirs to mean
  await a.db.close();
});

Deno.test("an address inside a code block is being shown, not offered", async () => {
  const a = await app();
  const { msg } = await rewriteLinks(a, { text: "run this:\n\n    curl https://example.test/a\n", format: "md" });
  assertEquals(msg.text, "run this:\n\n    curl https://example.test/a\n");
  await a.db.close();
});
