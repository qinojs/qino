import { hee, Output } from "@qino/qino";

import type { App, Ctx } from "@qino/qino";

const TTL = 3600;
const caches = new WeakMap<App, Map<string, { at: number; body: Promise<string> }>>();

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => route(ctx), { signal });
}

async function route(ctx: Ctx): Promise<void> {
  const path = ctx.req.appPath;
  if (path === "robots.txt") await serve(ctx, "text/plain", robots);
  if (path === "sitemap.xml") await serve(ctx, "application/xml", sitemap);
}

/** Answers from a per-app, per-base cache that expires after TTL seconds. */
async function serve(ctx: Ctx, type: string, build: (ctx: Ctx, base: string) => Promise<string>): Promise<void> {
  const base = ctx.req.url.origin + ctx.req.appUrl;
  const key = base + ctx.req.appPath;
  const cache = caches.get(ctx.app) ?? caches.set(ctx.app, new Map()).get(ctx.app)!;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL * 1000) {
    hit = { at: Date.now(), body: build(ctx, base) };
    hit.body.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  throw new Output(await hit.body, { headers: {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": `public, max-age=${TTL}`,
  } });
}

/** Modules add rules through `seo:robots`. */
async function robots(ctx: Ctx, base: string): Promise<string> {
  const { lines } = await ctx.app.fire("seo:robots", { ctx, base, lines: ["User-agent: *", "Allow: /"] });
  return `${lines.join("\n")}\n\nSitemap: ${base}sitemap.xml\n`;
}

type Entry = string | { url: string | Record<string, string>; lastmod?: number; image?: string };

/** Modules add entries through `seo:sitemap`: a URL, or `{ url, lastmod?, image? }` where `url` may map languages to URLs (hreflang). */
async function sitemap(ctx: Ctx, base: string): Promise<string> {
  const { urls } = await ctx.app.fire("seo:sitemap", { ctx, base, urls: [] as Entry[] });
  let items = "";
  for (const entry of urls) {
    const { url, lastmod, image } = typeof entry === "string" ? { url: entry } : entry;
    const langs = typeof url === "string" ? [] : Object.entries(url);
    const links = langs.length < 2 ? "" : langs.map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${hee(lang)}" href="${hee(href)}"/>`).join("");
    const extra = (lastmod ? `<lastmod>${new Date(lastmod * 1000).toISOString()}</lastmod>` : "")
      + (image ? `<image:image><image:loc>${hee(image)}</image:loc></image:image>` : "") + links;
    for (const loc of typeof url === "string" ? [url] : Object.values(url)) items += `<url><loc>${hee(loc)}</loc>${extra}</url>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${items}</urlset>\n`;
}
