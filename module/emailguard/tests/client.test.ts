import { assertEquals } from "@std/assert";
import { ResHtml } from "@qino/qino";

import { protect } from "../plugin.ts";

/** The client script against a stub DOM: proves the two halves agree, not just the encoding. */
Deno.test("emailguard: pub/main.js restores what the server encoded", async () => {
  const html = new ResHtml();
  html.content = '<a href="mailto:info@example.com?subject=Hi">mail</a><a href="/page">other</a>';
  protect(html, "/m/");

  const href = html.content.match(/href="(mailto:[^"]+)"/)![1];
  const anchor = { href, getAttribute: () => anchor.href, setAttribute: (_: string, v: string) => anchor.href = v };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = {
    querySelector: () => ({ textContent: JSON.stringify(html.jsData) }),
    querySelectorAll: () => [anchor],
  };
  await import("../pub/main.js");

  assertEquals(anchor.href, "mailto:info@example.com?subject=Hi");
});
