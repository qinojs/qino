import { assertEquals } from "../../core/tests/deps.ts";
import { html } from "../../core/mod.ts";
import { u2 } from "../mod.ts";

Deno.test("cms.backend: u2.time returns safe HTML", () => {
  assertEquals(String(u2.time(null)), "-");
  assertEquals(
    String(html`${u2.time("2024-01-02T03:04:00Z")}`),
    '<u2-time datetime="2024-01-02T03:04:00.000Z" type=relative minute>2024-01-02 03:04</u2-time>',
  );
  // narrow is the short wording for dense tables: "8d ago" instead of "8 days ago"
  assertEquals(String(u2.time("2024-01-02T03:04:00Z", { narrow: true })).includes("minute mode=narrow>"), true);
});
