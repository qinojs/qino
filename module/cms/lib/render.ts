import type { Ctx } from "../../core/mod.ts";
import { cms } from "./CMS.ts";
import { cmsCtx } from "./CmsContext.ts";

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

  // Set editmode early so Node.edit (sync getter) works during render
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
  const titleT = await pageObj.text("_title");
  const title = titleT ? String(await titleT.string()).replace(/<[^>]+>/g, "") : "";
  const pageTitle = await pageObj.title();
  ctx.res.html.title = title || (pageTitle ? String(await pageTitle.string() ?? "").replace(/<[^>]+>/g, "") : "");
  const metaDesc = await pageObj.text("_meta_description");
  ctx.res.html.meta["description"] = metaDesc ? String(await metaDesc.string()).replace(/<[^>]+>/g, "") : "";
  const metaKw = await pageObj.text("_meta_keywords");
  ctx.res.html.meta["keywords"]    = metaKw ? String(await metaKw.string()).replace(/<[^>]+>/g, "") : "";

  if (!pageObj.vs.searchable) ctx.res.html.meta["robots"] = "noindex, nofollow";

  const content = await mainNode.html();
  ctx.res.html.content += content;

  await app.fire("cms:page-ready", {ctx});

  ctx.res.headers.set("content-type", "text/html; charset=utf-8");
  ctx.res.headers.set("cache-control", "no-cache, no-store");
  ctx.res.headers.set("X-Frame-Options", "SAMEORIGIN");
}
