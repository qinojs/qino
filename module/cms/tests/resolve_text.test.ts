import { assertEquals } from "@qino/qino/tests";

import { resolveText } from "../lib/resolveText.ts";

import type { CMS } from "../lib/CMS.ts";

Deno.test("resolveText resolves file urls always, cmspid links only outside edit mode", async () => {
  const cms = {
    node: () => Promise.resolve({ exists: () => true, url: () => "/target-page" }),
    app: {
      dbFiles: {
        file: () => Promise.resolve({
          exists: () => Promise.resolve(true),
          get: () => Promise.resolve("abcdef1234567890"),
        }),
      },
    },
  } as unknown as CMS;
  const text = '<a href="cmspid://5">x</a><img src="/dbFile/7/u-stale/pic.jpg">';

  // The cache buster follows the file's current md5 in both modes — the editor saves the html back,
  // so an unresolved one would keep serving what the browser cached for that url.
  assertEquals(
    await resolveText(cms, text),
    '<a href="/target-page">x</a><img src="/dbFile/7/u-abcde/pic.jpg">',
  );
  assertEquals(
    await resolveText(cms, text, false),
    '<a href="cmspid://5">x</a><img src="/dbFile/7/u-abcde/pic.jpg">',
  );
});
