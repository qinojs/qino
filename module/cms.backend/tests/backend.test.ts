import { assertEquals } from "@qino/qino/tests";

import { ageColor, link } from "../lib/backend.ts";

Deno.test("cms.backend: ageColor fades from green over orange to none", () => {
  assertEquals(ageColor(1000, 1000), "color-mix(in oklch, var(--orange) 0%, var(--green))");
  assertEquals(ageColor(1000, 1060), "color-mix(in oklch, var(--orange) 50%, var(--green))");
  assertEquals(ageColor(1000, 1360), "color-mix(in oklch, currentColor 50%, var(--orange))");
  assertEquals(ageColor(1000, 1600), "");
  assertEquals(ageColor(undefined, 1000), "");
});

Deno.test("cms.backend: link links http(s) only — a client-sent javascript: stays text", () => {
  assertEquals(String(link("https://a.ch/?x=1&y=2")), `<a href="https://a.ch/?x=1&amp;y=2" target=_blank>https://a.ch/?x=1&amp;y=2</a>`);
  assertEquals(String(link("javascript:alert(1)")), "javascript:alert(1)");
  assertEquals(String(link(null)), "");
});
