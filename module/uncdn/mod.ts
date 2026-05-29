import * as nodePath from "node:path";
import { Output } from "../core/lib/util.ts";
import { assertNoSSRF } from "../core/lib/fileStream.ts";
import type { App } from "../core/server.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";
import type { HtmlBuilder } from "../core/lib/HtmlBuilder.ts";

export const name = "uncdn";
export const CACHE_SUBDIR = "cache/uncdn/";
export const DEFAULT_FETCH_POLICY = "superuser";
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

export const settingsSchema = {
  properties: {
    fetchPolicy: {
      type: "string",
      enum: ["superuser", "all", "none"],
      description: "Who may trigger fetching+caching of new external files via the proxy. 'superuser' = only superusers; 'all' = anyone; 'none' = only already-cached files are served.",
    },
    maxCacheBytes: {
      type: "integer",
      default: DEFAULT_MAX_CACHE_BYTES,
      minimum: 1024 * 1024,
      description: "Maximum total cache size in bytes.",
    },
  },
};

const PROXY_PREFIX = "uncdn/";
const MAX_ASSET_BYTES = 1024 * 1024;
const mediaTypesByExtension: Record<string, string> = {
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
  const root = nodePath.resolve(cacheDir);
  return target.startsWith(root + nodePath.sep) ? target : null;
}

function mediaTypeForPath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return mediaTypesByExtension[ext] ?? null;
}

export function cacheByteLimit(value: unknown): number {
  return Math.max(Number(value) || DEFAULT_MAX_CACHE_BYTES, MAX_ASSET_BYTES);
}

export function fetchPolicy(value: unknown): "superuser" | "all" | "none" {
  return value === "all" || value === "none" ? value : DEFAULT_FETCH_POLICY;
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

function done(ctx: RequestContext, status: number, body: string): never {
  ctx.responseStatus = status;
  ctx.responseBody = body;
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

async function serveCached(filePath: string, mediaType: string, ctx: RequestContext): Promise<void> {
  const data = await Deno.readFile(filePath).catch(() => null);
  if (data) serveResponse(mediaType, data);
}

async function fetchAndCache(url: string, filePath: string, cacheDir: string, mediaType: string, ctx: RequestContext): Promise<void> {
  await assertNoSSRF(url); // blocks hosts resolving to private/internal IPs
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES) throw new Error(`fetch ${url} too large`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error(`fetch ${url} too large`);
  const maxCacheBytes = cacheByteLimit(await ctx.app.settings.uncdn.maxCacheBytes);
  if (await directorySize(cacheDir) + data.byteLength > maxCacheBytes) done(ctx, 507, "Cache full");
  await Deno.mkdir(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeFile(filePath, data);
  serveResponse(mediaType, data);
}

export function init(app: App): void {
  const cacheDir = app.appPATH + CACHE_SUBDIR;

  app.on("action", async e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.appRequestUri.startsWith(PROXY_PREFIX)) return;
    const rest = ctx.appRequestUri.slice(PROXY_PREFIX.length);
    if (!rest) return;
    if (Object.keys(ctx.get ?? {}).length) done(ctx, 404, "Not allowed");

    const url = "https://" + rest;
    const filePath = urlToPath(cacheDir, url);
    if (!filePath) done(ctx, 404, "Not allowed");
    const mediaType = mediaTypeForPath(filePath);
    if (!mediaType) done(ctx, 404, "Not allowed");

    await serveCached(filePath, mediaType, ctx); // throws Output if found

    const policy = fetchPolicy(await ctx.app.settings.uncdn.fetchPolicy);

    const denied =
      policy === "none" ? "fetchPolicy=none" :
      policy === "superuser" && !await ctx.user?.get?.("superuser") ? "fetchPolicy=superuser but no superuser session" :
      null;
    if (denied) {
      console.warn(`[uncdn] ${denied}, not fetching: ${url}`);
      done(ctx, 404, "Not cached");
    }

    await fetchAndCache(url, filePath, cacheDir, mediaType, ctx);
  });

  app.on("html-ready", e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.html) return;
    rewriteHtml(ctx.html, ctx.appURL);
  });
}

export function rewriteHtml(html: HtmlBuilder, appURL: string): void {
  const rewrite = (files: Set<string>): Set<string> => {
    const result = new Set<string>();
    for (const url of files) {
      if ((url.startsWith("https://") || url.startsWith("http://")) && !/[?#]/.test(url)) {
        const path = PROXY_PREFIX + url.replace(/^https?:\/\//, "");
        result.add(appURL + path);
      } else {
        result.add(url);
      }
    }
    return result;
  };
  html.legacyScripts = rewrite(html.legacyScripts);
  html.scripts       = rewrite(html.scripts);
  html.styles        = rewrite(html.styles);
}
