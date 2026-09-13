import * as nodePath from "node:path";
import { serveFile } from "@std/http/file-server";
import { Output, safeFetch } from "@qino/qino";

import { DEFAULT_MAX_CACHE_BYTES, MAX_ASSET_BYTES, cacheByteLimit, uncdn } from "./mod.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, ResHtml, ResCsp } from "@qino/qino";

const { name } = manifest;

export const settingsSchema = {
  properties: {
    maxCacheBytes: {
      type: "integer",
      default: DEFAULT_MAX_CACHE_BYTES,
      minimum: MAX_ASSET_BYTES,
      description: "Maximum total cache size in bytes.",
    },
  },
};

const PROXY_PREFIX = "uncdn/";
const notFound = (reason: string) => new Output(reason, { status: 404 });
const SVG = "image/svg+xml";
const MEDIA_TYPES: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  wasm: "application/wasm",
  woff2: "font/woff2",
  svg: SVG,
};

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

// Own the media type rather than trusting an extension table, and pin the cache: a proxy url
// names one immutable asset. `from` carries over what serveFile negotiated (etag, range, length).
function cacheHeaders(type: string, from?: Headers): Headers {
  const headers = new Headers(from);
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  // an svg is served inline by the browser, so deny it everything but its own styles
  if (type === SVG) headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  return headers;
}

async function fetchAndCache(app: App, url: string, filePath: string, cacheDir: string): Promise<Uint8Array> {
  const res = await safeFetch(url); // SSRF-guarded, re-checked after redirects; safeFetch applies a default timeout
  const tooBig = Number(res.headers.get("content-length")) > MAX_ASSET_BYTES;
  if (!res.ok || tooBig) {
    await res.body?.cancel();
    throw new Error(`fetch ${url} → ${tooBig ? "too large" : res.status}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error(`fetch ${url} too large`);
  const maxCacheBytes = cacheByteLimit(await app.settings.uncdn.maxCacheBytes);
  if (await directorySize(cacheDir) + data.byteLength > maxCacheBytes) throw new Output("Cache full", { status: 507 });
  await Deno.mkdir(nodePath.dirname(filePath), { recursive: true });
  const partPath = `${filePath}.part-${crypto.randomUUID()}`;
  try {
    await Deno.writeFile(partPath, data);
    await Deno.rename(partPath, filePath);
  } catch (error) {
    await Deno.remove(partPath).catch(() => {});
    throw error;
  }
  return data;
}

type CspSources = Record<string, true>;
// https only: the proxy path carries no scheme and is fetched back as https, so an
// http source rewritten into it could never be served — and a plain-http origin is
// a local one anyway, which this proxy has no reason to stand in front of.
const origins = (s: CspSources) => Object.keys(s).filter(k => k.startsWith("https://"));
const mapSet = (set: Set<string>, fn: (value: string) => string) => new Set(set.values().map(fn));
// A CSP source covers a url as a prefix only at a path boundary, so "https://cdn.example"
// does not cover "https://cdn.example.attacker.test/a.js".
const covers = (source: string, url: string) => url.startsWith(source) && (source.endsWith("/") || url[source.length] === "/");

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const cacheDir = app.modules.get(name)!.cache;
  const cacheRoot = nodePath.resolve(cacheDir) + nodePath.sep;
  const running = new Map<string, Promise<Uint8Array>>();
  const allowed = uncdn(app).origins; // sources pages declared via CSP — the only thing this proxy fetches

  // Served before routing — a cached asset is a static file and needs neither session nor database.
  app.on("request-start", async ({ request, base }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(base + PROXY_PREFIX)) return; // this hook sees every request
    let rest: string;
    try { rest = decodeURIComponent(url.pathname.slice(base.length + PROXY_PREFIX.length)); } catch { return; }
    if (!rest) return;

    const target = URL.parse("https://" + rest);
    if (!target || url.search) throw notFound("Not allowed");
    const type = MEDIA_TYPES[rest.split(".").pop()!.toLowerCase()];
    const filePath = nodePath.resolve(cacheDir, target.hostname + target.pathname);
    if (!type || !filePath.startsWith(cacheRoot)) throw notFound("Not allowed");

    // streams and answers conditional requests; 404 is exactly the "not cached yet" case
    const hit = await serveFile(request, filePath);
    // ?? undefined: a 304 carries no body, and Output would turn a null one into "null"
    if (hit.status !== 404) throw new Output(hit.body ?? undefined, { status: hit.status, headers: cacheHeaders(type, hit.headers) });
    await hit.body?.cancel();

    // The CSP declaration is the whole permission — what no page asked for is never fetched.
    if (![...allowed].some(o => covers(o, target.href))) throw notFound("Not cached");

    const pending = running.getOrInsertComputed(filePath, () =>
      fetchAndCache(app, target.href, filePath, cacheDir).finally(() => running.delete(filePath))
    );
    throw new Output(await pending, { headers: cacheHeaders(type) });
  }, { signal });

  app.on("html-ready", ({ ctx }) => {
    if (ctx.res.hasHtml) rewriteHtml(ctx.res.html, ctx.req.appUrl, ctx.res.csp, allowed);
  }, { signal });
}

// Rewrite assets to the proxy, but only for origins the page declared in its CSP
// (per directive: script-src gates scripts, style-src gates styles). Fonts/images
// referenced relatively inside a proxied CSS cascade through the proxy on their own.
// Every declared source is remembered in `allowed` — that is what the proxy will fetch.
export function rewriteHtml(html: ResHtml, appUrl: string, csp: ResCsp, allowed = new Set<string>()): void {
  const rewritten = new Set<string>();
  const rewriter = (src: CspSources) => {
    const allow = origins(src);
    for (const o of allow) allowed.add(o);
    return (url: string): string => {
      if (!url.startsWith("https://") || /[?#]/.test(url)) return url;
      const hit = allow.find(p => covers(p, url));
      if (!hit) return url;
      rewritten.add(hit);
      return appUrl + PROXY_PREFIX + url.slice("https://".length);
    };
  };
  const rwScript = rewriter(csp["script-src"]), rwStyle = rewriter(csp["style-src"]);
  for (const [name, url] of html.importMap) html.importMap.set(name, rwScript(url));
  html.legacyScripts = mapSet(html.legacyScripts, rwScript);
  html.scripts       = mapSet(html.scripts, rwScript);
  html.styles        = mapSet(html.styles, rwStyle);
  // a sheet with attributes (media) lives in html.link instead of html.styles, and needs the same rewrite
  for (const [url, attr] of Object.entries(html.link)) {
    const to = attr.rel === "stylesheet" ? rwStyle(url) : url;
    if (to === url) continue;
    delete html.link[url];
    html.link[to] = attr;
  }

  // Drop origins now served same-origin; ones still referenced (e.g. query-string URLs) stay.
  // Only what this pass actually moved: a source no html asset names may still be needed by an
  // import inside a script, which is nothing this rewrite can see.
  const strip = (src: CspSources, urls: string[]) => {
    for (const o of origins(src)) if (rewritten.has(o) && !urls.some(u => u.startsWith(o))) delete src[o];
  };
  strip(csp["script-src"], [...html.scripts, ...html.legacyScripts, ...html.importMap.values()]);
  strip(csp["style-src"], [...html.styles, ...Object.keys(html.link)]);
}
