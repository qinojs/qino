import { cms, cmsCtx } from "@qino/qino/cms";

import { image, text } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // Tags for shared links. The page's own values win, then what a layout or module set, then the defaults.
  cms(app).on("page:render-after", async ({ ctx }) => {
    const html = ctx.res.html, meta = html.meta;
    const page = await cmsCtx(ctx).mainNode.page();
    const file = await image(page);
    meta["og:title"] = await text(page, "_share_title") || meta["og:title"] || html.title;
    meta["og:description"] = await text(page, "_share_description") || meta["og:description"] || meta.description;
    if (file) meta["og:image"] = ctx.req.url.origin + await file.url();
    meta["twitter:card"] = meta["og:image"] ? "summary_large_image" : "summary";
    if (cmsCtx(ctx).editmode && !ctx.req.query.cms_noFrontend)
      html.scripts.add(ctx.req.moduleUrl + "cms.seo/pub/init.mjs");
  }, { signal });

  // Public pages for the sitemap; non-public or offline subtrees are skipped.
  // lastmod: latest change of the page or its contents.
  app.on("seo:sitemap", async ({ ctx, base, urls }) => {
    const changed = new Map<number, number>();
    for (const row of await app.db.query`SELECT nc.page_id, MAX(l.time) AS time
      FROM node_changed nc JOIN log l ON l.id = nc.log_id GROUP BY nc.page_id`)
      changed.set(Number(row.page_id), Number(row.time));
    const walk = async (node: Node) => {
      for (const page of (await node.children({ type: "p" })).values()) {
        if (!await page.isPublic() || !await page.isOnline()) continue;
        if (page.vs.searchable) {
          const url: Record<string, string> = {};
          for (const lang of app.languages.all) url[lang] = base + await page.urlSeo(lang);
          const file = await image(page);
          urls.push({ url, lastmod: changed.get(page.id), image: file && ctx.req.url.origin + await file.url() });
        }
        await walk(page);
      }
    };
    await walk(await cms(app).node(1));
  }, { signal });
}
