import { cms } from "./CMS.ts";
import { cmsCtx } from "./CmsContext.ts";
import { hasOwnUrl } from "./urls.ts";

import type { Ctx } from "@qino/qino";

export async function render(ctx: Ctx): Promise<void> {
  const app = ctx.app;
  const cm = cms(app);

  let page = await cm.nodeFromRequest();

  if (!page.exists()) {
    const redirect = await app.db.one`SELECT redirect FROM page_redirect WHERE request = ${ctx.req.appPath}`;
    if (redirect) {
      const url = isNaN(Number(redirect)) ? String(redirect) : ctx.req.url.origin + await (await cm.node(Number(redirect))).url();
      ctx.res.headers.set("Location", url);
      ctx.res.status = 301;
      return;
    }
    ctx.res.status = 404;
    page = await cm.nodeByPath(["system", "not-found"]) ?? await cm.node(0);
  }

  const state = cmsCtx(ctx);
  state.mainNode = page;
  state.requestedNode = page;

  const access = await page.access();

  if (!access) {
    ctx.res.status = 401;
    state.mainNode = await cm.nodeByPath(["system", "no-access"]) ?? await cm.node(0);
  }
  if (!(await state.mainNode.isReadable())) {
    ctx.res.status = 401;
    // a site without a page of its own for being offline shows the one for missing access
    state.mainNode = await cm.nodeByPath(["system", "offline"]) ??
      await cm.nodeByPath(["system", "no-access"]) ?? await cm.node(0);
  }

  // a content with an address of its own: its page renders around it, and it speaks for the page
  const requested = state.mainNode;
  const own = await hasOwnUrl(requested);
  const pageObj = await requested.page();
  if (own) state.mainNode = pageObj;
  const mainNode = state.mainNode;
  const speaker = own ? requested : pageObj;
  const plain = async (name: string) => (await speaker.showText(name)).plain();
  const doc = ctx.res.html;
  doc.title = await plain("_title") || (await speaker.showTitle()).plain();
  doc.meta.description = await plain("_description");

  if (pageObj.vs.searchable) {
    // hreflang alternates: only meaningful with more than one language, and only for indexable pages
    const langs = app.languages.all;
    if (langs.length > 1)
      for (const l of langs) doc.link[ctx.req.url.origin + await speaker.url(l)] = { rel: "alternate", hreflang: l };
  } else doc.meta.robots = "noindex, nofollow";

  doc.content += await mainNode.html();

  await cm.fire("page:render-after", {ctx});

  ctx.res.headers.set("X-Frame-Options", "SAMEORIGIN");
}
