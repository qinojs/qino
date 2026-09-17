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

async function robots(_ctx: Ctx, base: string): Promise<string> {
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`;
}

/** Modules add absolute URLs through `seo:sitemap`. */
async function sitemap(ctx: Ctx, base: string): Promise<string> {
  const { urls } = await ctx.app.fire("seo:sitemap", { ctx, base, urls: [] as string[] });
  const items = [...new Set(urls)].map((url) => `  <url><loc>${hee(url)}</loc></url>\n`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}</urlset>\n`;
}
