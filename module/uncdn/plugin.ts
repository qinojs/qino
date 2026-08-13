import * as nodePath from "node:path";
import { Output, safeFetch } from "@qino/qino";

import { DEFAULT_MAX_CACHE_BYTES, cacheByteLimit } from "./mod.ts";
import { MAX_ASSET_BYTES, uncdnInstances } from "./internal.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, ResHtml, ResCsp } from "@qino/qino";

const { name } = manifest;

export const settingsSchema = {
  properties: {
    maxCacheBytes: {
      type: "integer",
      default: DEFAULT_MAX_CACHE_BYTES,
      minimum: 1024 * 1024,
      description: "Maximum total cache size in bytes.",
    },
  },
};

const PROXY_PREFIX = "uncdn/";
const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  wasm: "application/wasm",
  woff2: "font/woff2",
  svg: "image/svg+xml",
};

function urlToPath(cacheDir: string, url: string): string | null {
  const u = new URL(url);
  const target = nodePath.resolve(cacheDir, u.hostname + u.pathname);
  return target.startsWith(nodePath.resolve(cacheDir) + nodePath.sep) ? target : null;
}

function mediaTypeForPath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES_BY_EXTENSION[ext] ?? null;
}

async function directorySize(path: string): Promise<number> {
  let size = 0;
  try {
    for await (const e of Deno.readDir(path)) {
      const file = path + e.name;
      if (e.isDirectory) size += await directorySize(file + "/");
      else if (e.isFile) size += (await Deno.stat(file)).size;
    }
  } catch { /* cache dir may not exist yet */ }
  return size;
}

function done(ctx: Ctx, status: number, body: string): never {
  ctx.res.status = status;
  ctx.res.body = body;
  throw new Output();
}

function serveResponse(mediaType: string, data: Uint8Array): never {
  const headers: Record<string, string> = {
    "Content-Type": mediaType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (mediaType === "image/svg+xml") headers["Content-Security-Policy"] = "script-src 'none'";
  throw new Output(data, { headers });
}

async function fetchAndCache(url: string, filePath: string, cacheDir: string, mediaType: string, ctx: Ctx): Promise<void> {
  const res = await safeFetch(url); // SSRF-guarded, re-checked after redirects; safeFetch applies a default timeout
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_ASSET_BYTES) throw new Error(`fetch ${url} too large`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error(`fetch ${url} too large`);
  const maxCacheBytes = cacheByteLimit(await ctx.app.settings.uncdn.maxCacheBytes);
  if (await directorySize(cacheDir) + data.byteLength > maxCacheBytes) done(ctx, 507, "Cache full");
  await Deno.mkdir(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeFile(filePath, data);
  serveResponse(mediaType, data);
}

type CspSources = Record<string, true>;
const origins = (s: CspSources) => Object.keys(s).filter(k => /^https?:\/\//.test(k));
const mapSet = (set: Set<string>, fn: (value: string) => string) => new Set([...set].map(fn));

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const cacheDir = app.modules.get(name)!.cache;
  const allowed = new Set<string>(); // sources pages declared via CSP — the only thing this proxy fetches
  uncdnInstances.set(app, { origins: allowed });

  app.on("route", async ({ ctx }) => {
    if (!ctx.req.appPath.startsWith(PROXY_PREFIX)) return;
    const rest = ctx.req.appPath.slice(PROXY_PREFIX.length);
    if (!rest) return;
    if (Object.keys(ctx.req.query).length) done(ctx, 404, "Not allowed");

    const url = "https://" + rest;
    const origin = new URL(url).origin;
    const filePath = urlToPath(cacheDir, url);
    if (!filePath) done(ctx, 404, "Not allowed");
    const mediaType = mediaTypeForPath(filePath);
    if (!mediaType) done(ctx, 404, "Not allowed");

    const data = await Deno.readFile(filePath).catch(() => null);
    if (data) serveResponse(mediaType, data);

    // The CSP declaration is the whole permission — what no page asked for is never fetched.
    if (![...allowed].some(o => new URL(o).origin === origin && url.startsWith(o))) done(ctx, 404, "Not cached");

    await fetchAndCache(url, filePath, cacheDir, mediaType, ctx);
  }, { signal });

  app.on("html-ready", ({ ctx }) => {
    if (!ctx.res.hasHtml) return;
    for (const o of [...origins(ctx.res.csp["script-src"]), ...origins(ctx.res.csp["style-src"])]) allowed.add(o);
    rewriteHtml(ctx.res.html, ctx.req.appUrl, ctx.res.csp);
  }, { signal });
}

// Rewrite assets to the proxy, but only for origins the page declared in its CSP
// (per directive: script-src gates scripts, style-src gates styles). Fonts/images
// referenced relatively inside a proxied CSS cascade through the proxy on their own.
export function rewriteHtml(html: ResHtml, appUrl: string, csp: ResCsp): void {
  const rewriter = (src: CspSources) => {
    const allow = origins(src);
    return (url: string): string =>
      /^https?:\/\//.test(url) && !/[?#]/.test(url) && allow.some(p => url.startsWith(p))
        ? appUrl + PROXY_PREFIX + url.replace(/^https?:\/\//, "") : url;
  };
  const rwScript = rewriter(csp["script-src"]), rwStyle = rewriter(csp["style-src"]);
  for (const [name, url] of html.importMap) html.importMap.set(name, rwScript(url));
  html.legacyScripts = mapSet(html.legacyScripts, rwScript);
  html.scripts       = mapSet(html.scripts, rwScript);
  html.styles        = mapSet(html.styles, rwStyle);

  // drop origins now served same-origin; ones still referenced (e.g. query-string URLs) stay
  stripDead(csp["script-src"], html.scripts, html.legacyScripts, html.importMap.values());
  stripDead(csp["style-src"], html.styles);
}

function stripDead(src: CspSources, ...refs: Iterable<string>[]): void {
  const urls = refs.flatMap(ref => [...ref]);
  for (const o of origins(src)) if (!urls.some(u => u.startsWith(o))) delete src[o];
}
