import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { html, requestStorage } from "../../core/mod.ts";
import { CMS } from "../lib/CMS.ts";
import { sanitizeHtml } from "../lib/sanitize.ts";

Deno.test("CMS.link keeps sanitized title HTML and escapes attributes", async () => {
  const ctx = await testContext();
  ctx.lang = "de";
  const cms = new CMS(ctx.app);
  const raw = '<strong>Title</strong><img src=x onerror="alert(1)"><script>alert(2)</script>';
  const page = {
    urlSeo: () => {},
    urls: () => ({ de: { target: 'x" onclick="alert(3)' } }),
    showTitle: () => sanitizeHtml(raw),
  };
  cms.node = () => Promise.resolve(page as never);
  cms.linkAttributes = () => Promise.resolve(html.raw(' href="/page"'));

  await requestStorage.run(ctx, async () => {
    assertEquals(
      String(await cms.link(1)),
      '<a href="/page" target="x&quot; onclick=&quot;alert(3)"><strong>Title</strong><img src="x" /></a>',
    );
  });
});
