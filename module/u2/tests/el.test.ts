import { html } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import * as el from "../lib/el.ts";

Deno.test("u2: el.time returns safe HTML", () => {
  assertEquals(String(el.time(null)), "-");
  assertEquals(
    String(html`${el.time("2024-01-02T03:04:00Z")}`),
    '<u2-time datetime="2024-01-02T03:04:00.000Z" type=relative minute>2024-01-02 03:04</u2-time>',
  );
  // narrow is the short wording for dense tables: "8d ago" instead of "8 days ago"
  assertEquals(String(el.time("2024-01-02T03:04:00Z", { narrow: true })).includes("minute mode=narrow>"), true);
});
