import { cms, cmsCtx, hasOwnUrl } from "@qino/qino/cms";

import { imageUrl, text } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // Tags for shared links. The page's own values win, then what a layout or module set, then the defaults.
  cms(app).on("page:render-after", async ({ ctx }) => {
    const html = ctx.res.html, meta = html.meta, c = cmsCtx(ctx);
    const page = await c.mainNode.page();
    const [file, title, desc] = await Promise.all([page.cms.image(page, { use: "share" }), text(page, "_share_title"), text(page, "_share_description")]);
    meta["og:title"] = title || meta["og:title"] || html.title;
    meta["og:description"] = desc || meta["og:description"] || meta.description;
    // the size the platforms show (1.91:1)
    if (file) meta["og:image"] = ctx.req.url.origin + await imageUrl(file, 1200, 630);
    meta["twitter:card"] = meta["og:image"] ? "summary_large_image" : "summary";
    if (c.editmode && !ctx.req.query.cms_noFrontend)
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
          const addresses = async (n: Node) => {
            const url: Record<string, string> = {};
            for (const lang of app.languages.all) url[lang] = base + await n.urlSeo(lang);
            return url;
          };
          const file = await page.cms.image(page, { use: "share" });
          urls.push({ url: await addresses(page), lastmod: changed.get(page.id), image: file && ctx.req.url.origin + await file.url() });
          for (const cont of (await page.bough({ type: "c" })).values()) {
            if (await hasOwnUrl(cont) && await cont.isPublic() && await cont.isOnline()) urls.push({ url: await addresses(cont), lastmod: changed.get(page.id) });
          }
        }
        await walk(page);
      }
    };
    await walk(await cms(app).node(1));
  }, { signal });
}
