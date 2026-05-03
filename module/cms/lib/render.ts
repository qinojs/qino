/**
 * render.ts - CMS render handler
 * Port of cms/lib/cms.class.php (render method)
 */

import type { RequestContext } from "../../core/lib/context.ts";


export async function render(ctx: RequestContext): Promise<void> {
  const app = ctx.app;
  const db = ctx.app.db;
  const cms = ctx.app.cms;

  let Page = await cms.nodeFromRequest();
  if (!(await Page.is())) {
    // Search for redirect
    const redirect = await db.one("SELECT redirect FROM page_redirect WHERE request = ?", [ctx.appRequestUri]);
    if (redirect) {
      let url: string;
      if (!isNaN(parseInt(String(redirect)))) {
        const P = await cms.node(parseInt(String(redirect)));
        url = new URL(ctx.req.url).origin + (await P.url());
      } else {
        url = String(redirect);
      }
      ctx.responseHeaders.set("Location", url);
      ctx.responseStatus = 301;
      return "";
    }
    // Not found
    ctx.responseStatus = 404;
    const notFoundId = await app.settings.cms.pageNotFound ?? 0;
    Page = await cms.node(parseInt(String(notFoundId)));
  }

  cms.MainNode = Page;
  cms.RequestedNode = Page;

  // Set editmode early so Node.edit (sync getter) works during render
  const access = await Page.access();

  if (!access) {
    ctx.responseStatus = 401;
    const noAccessId = await app.settings.cms.pageNoAccess ?? 0;
    cms.MainNode = await cms.node(parseInt(String(noAccessId)));
  }
  if (!(await cms.MainNode.isReadable())) {
    ctx.responseStatus = 401;
    const offlineId = await app.settings.cms.pageOffline;
    cms.MainNode = await cms.node(parseInt(String(offlineId ?? "0")));
  }

  const mainNode = cms.MainNode;
  const PageObj = await mainNode.page();
  const titleT = await PageObj.text("_title");
  const title = titleT ? String(await titleT.string()).replace(/<[^>]+>/g, "") : "";
  const pageTitle = await PageObj.title?.();
  ctx.html.title = title || (pageTitle ? String(await pageTitle.string() ?? "").replace(/<[^>]+>/g, "") : "");
  const metaDesc = await PageObj.text?.("_meta_description");
  ctx.html.meta["description"] = metaDesc ? String(await metaDesc.string()).replace(/<[^>]+>/g, "") : "";
  const metaKw = await PageObj.text?.("_meta_keywords");
  ctx.html.meta["keywords"]    = metaKw ? String(await metaKw.string()).replace(/<[^>]+>/g, "") : "";

  if (!PageObj.vs.searchable) ctx.html.meta["robots"] = "noindex, nofollow";

  ctx.html.meta["generator"]   = "Vanilla CMS 9.0";

  const content = await mainNode.html();
  ctx.html.content += content;

  await app.fire("cms-ready", {ctx});

  ctx.responseHeaders.set("content-type", "text/html; charset=utf-8");
  ctx.responseHeaders.set("cache-control", "no-cache, no-store");
  ctx.responseHeaders.set("X-Frame-Options", "SAMEORIGIN");
}
