import { assertEquals } from "../../core/tests/deps.ts";
import { sanitizeHtml } from "../../cms/mod.ts";
import renderTexts from "../view/widgets/txts.ts";

Deno.test("cms.frontend.2 texts: sanitizes stored HTML", async () => {
  const raw = '<strong>Title</strong><img src=x onerror="alert(1)"><script>alert(2)</script>';
  const node = {
    access: () => 2,
    texts: () => ({ main: { id: 7, string: () => raw } }),
    showText: () => sanitizeHtml(raw),
  };
  const out = String(await renderTexts(node as never));

  assertEquals(out.includes("<strong>Title</strong>"), true);
  assertEquals(out.includes("onerror"), false);
  assertEquals(out.includes("<script"), false);
});
