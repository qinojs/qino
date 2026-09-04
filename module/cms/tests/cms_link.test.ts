import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { CMS } from "../lib/CMS.ts";
import { sanitizeHtml } from "../lib/sanitize.ts";

Deno.test("CMS.link keeps sanitized title HTML", async () => {
  const ctx = await testContext();
  ctx.lang = "de";
  const cms = new CMS(ctx.app);
  const raw = '<strong>Title</strong><img src=x onerror="alert(1)"><script>alert(2)</script>';
  const page = {
    urlSeo: () => {},
    urls: () => new Map([["de", { target: 'x" onclick="alert(3)' }]]),
    showTitle: () => sanitizeHtml(raw),
  };
  cms.node = () => Promise.resolve(page as never);
  cms.linkAttributes = () => Promise.resolve({ href: "/page", target: 'x" onclick="alert(3)' });

  await requestStorage.run(ctx, async () => {
    assertEquals(
      String(await cms.link(1)),
      '<a href="/page" target="x&quot; onclick=&quot;alert(3)"><strong>Title</strong><img src="x" /></a>',
    );
  });
});

Deno.test("CMS.linkAttributes describes the target state", async () => {
  const ctx = await testContext();
  ctx.lang = "de";
  const cms = new CMS(ctx.app);
  const page = {
    edit: () => true,
    toString: () => "7",
    urlSeo: () => {},
    urls: () => new Map([["de", { target: 'x" onclick="alert(1)' }]]),
    url: () => '/page?a=1&b="2"',
    access: () => 0,
    in: () => true,
    isOnline: () => false,
    title: () => ({ id: 42 }),
  };
  cms.node = () => Promise.resolve(page as never);
  cms.nodeFromRequest = () => Promise.resolve(page as never);

  await requestStorage.run(ctx, async () => {
    assertEquals(
      await cms.linkAttributes(7),
      {
        href: '/page?a=1&b="2"',
        class: "cmsLink7 noAccess cmsInside cmsOffline",
        cmstxt: "42",
        "aria-current": "page",
        target: 'x" onclick="alert(1)',
      },
    );
  });
});
