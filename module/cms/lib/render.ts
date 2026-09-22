import { cms } from "./CMS.ts";
import { cmsCtx } from "./CmsContext.ts";

import type { Ctx } from "@qino/qino";

export async function render(ctx: Ctx): Promise<void> {
  const app = ctx.app;
  const db = app.db;
  const cm = cms(app);

  let page = await cm.nodeFromRequest();

  if (!page.exists()) {
    // Search for redirect
    const redirect = await db.one`SELECT redirect FROM page_redirect WHERE request = ${ctx.req.appPath}`;
    if (redirect) {
      let url: string;
      if (!isNaN(Number(redirect))) {
        const target = await cm.node(Number(redirect));
        url = ctx.req.url.origin + (await target.url());
      } else {
        url = String(redirect);
      }
      ctx.res.headers.set("Location", url);
      ctx.res.status = 301;
      return;
    }
    // Not found
    ctx.res.status = 404;
    const notFoundId = await app.settings.cms.pageNotFound ?? 0;
    page = await cm.node(Number(notFoundId));
  }

  cmsCtx(ctx).mainNode = page;
  cmsCtx(ctx).requestedNode = page;

  const access = await page.access();

  if (!access) {
    ctx.res.status = 401;
    const noAccessId = await app.settings.cms.pageNoAccess ?? 0;
    cmsCtx(ctx).mainNode = await cm.node(Number(noAccessId));
  }
  if (!(await cmsCtx(ctx).mainNode.isReadable())) {
    ctx.res.status = 401;
    const offlineId = await app.settings.cms.pageOffline;
    cmsCtx(ctx).mainNode = await cm.node(Number(offlineId ?? "0"));
  }

  const mainNode = cmsCtx(ctx).mainNode;
  const pageObj = await mainNode.page();
  const plain = async (name: string) => (await pageObj.showText(name)).plain();
  ctx.res.html.title = await plain("_title") || (await pageObj.showTitle()).plain();
  ctx.res.html.meta.description = await plain("_meta_description");
  ctx.res.html.meta.keywords    = await plain("_meta_keywords");

  if (!pageObj.vs.searchable) ctx.res.html.meta.robots = "noindex, nofollow";

  // hreflang alternates: only meaningful with more than one language, and only for indexable pages
  const langs = app.languages.all;
  if (langs.length > 1 && pageObj.vs.searchable)
    for (const l of langs) ctx.res.html.link[ctx.req.url.origin + await mainNode.url(l)] = { rel: "alternate", hreflang: l };

  const content = await mainNode.html();
  ctx.res.html.content += content;

  await app.fire("cms:page-ready", {ctx});

  ctx.res.headers.set("X-Frame-Options", "SAMEORIGIN");
}
